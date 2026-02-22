import { Router, type Request, type Response } from 'express';
import { getDb } from '../db/connection';
import * as sync from '../services/sync';
import * as alerts from '../services/alerts';
import logger from '../services/logger';
import type { InstitutionRow } from '../types';

const router = Router();

interface WebhookBody {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: unknown;
}

router.post('/', async (req: Request<unknown, unknown, WebhookBody>, res: Response) => {
  const { webhook_type, webhook_code, item_id } = req.body;

  logger.info(`Webhook received: ${webhook_type}/${webhook_code} for item ${item_id}`);

  const db = getDb();
  const inst = db.prepare(
    'SELECT * FROM institutions WHERE plaid_item_id = ?'
  ).get(item_id) as InstitutionRow | undefined;

  if (!inst) {
    logger.warn(`Webhook for unknown item: ${item_id}`);
    res.json({ received: true });
    return;
  }

  try {
    switch (webhook_type) {
      case 'TRANSACTIONS': {
        if (webhook_code === 'SYNC_UPDATES_AVAILABLE') {
          const result = await sync.syncInstitution(inst.id);
          logger.info(`Webhook-triggered sync for ${inst.institution_name}: ${JSON.stringify(result)}`);

          const triggered = alerts.evaluateAlerts();
          if (triggered.length > 0) {
            await alerts.dispatchAlerts(triggered);
          }
        }
        break;
      }

      case 'ITEM': {
        if (webhook_code === 'ERROR' || webhook_code === 'PENDING_EXPIRATION') {
          db.prepare('UPDATE institutions SET status = ? WHERE id = ?')
            .run('pending_reauth', inst.id);

          await alerts.dispatchAlerts([{
            type: 'reauth_needed',
            message: `⚠️ ${inst.institution_name} needs re-authentication (${webhook_code})`,
          }]);
        }
        break;
      }

      default:
        logger.info(`Unhandled webhook: ${webhook_type}/${webhook_code}`);
    }
  } catch (err) {
    logger.error(`Webhook processing failed: ${(err as Error).message}`);
  }

  res.json({ received: true });
});

export default router;
