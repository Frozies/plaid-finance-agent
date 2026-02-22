import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { Products } from 'plaid';
import * as plaid from '../services/plaid';
import { encrypt } from '../services/crypto';
import { getDb } from '../db/connection';
import * as sync from '../services/sync';
import logger from '../services/logger';
import type { AccountRow } from '../types';

const router = Router();

interface LinkTokenBody {
  userId?: string;
  products?: Products[];
  accessToken?: string;
}

router.post('/token', async (req: Request<unknown, unknown, LinkTokenBody>, res: Response, next: NextFunction) => {
  try {
    const { userId, products, accessToken } = req.body;

    const options: { userId: string; products?: Products[]; updateMode?: { accessToken: string } } = {
      userId: userId ?? 'default-user',
    };
    if (products) options.products = products;
    if (accessToken) options.updateMode = { accessToken };

    const data = await plaid.createLinkToken(options);

    res.json({
      link_token: data.link_token,
      expiration: data.expiration,
      link_url: `/public/link.html?token=${data.link_token}`,
    });
  } catch (err) {
    next(err);
  }
});

interface ExchangeBody {
  public_token?: string;
  institution?: { name?: string };
}

router.post('/exchange', async (req: Request<unknown, unknown, ExchangeBody>, res: Response, next: NextFunction) => {
  try {
    const { public_token, institution: institutionInfo } = req.body;

    if (!public_token) {
      res.status(400).json({ error: 'public_token is required' });
      return;
    }

    const exchangeData = await plaid.exchangePublicToken(public_token);
    const { access_token, item_id } = exchangeData;

    const encrypted = encrypt(access_token);

    const itemData = await plaid.getItem(access_token);
    const instName = institutionInfo?.name ?? 'Unknown Institution';
    const instId = itemData.item?.institution_id ?? null;

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO institutions (id, plaid_item_id, institution_id, institution_name,
        encrypted_access_token, iv, auth_tag, products)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item_id,
      instId,
      instName,
      encrypted.encrypted,
      encrypted.iv,
      encrypted.authTag,
      JSON.stringify(itemData.item?.products ?? [])
    );

    logger.info(`Linked institution: ${instName} (${id})`);

    try {
      await sync.syncBalances(id);
      await sync.syncInstitution(id);
    } catch (syncErr) {
      logger.warn(`Initial sync partially failed for ${id}: ${(syncErr as Error).message}`);
    }

    const accounts = db.prepare('SELECT * FROM accounts WHERE institution_id = ?').all(id) as AccountRow[];

    res.json({
      success: true,
      institution_id: id,
      institution_name: instName,
      accounts: accounts.map((a) => ({
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        mask: a.mask,
        balance: a.current_balance,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
