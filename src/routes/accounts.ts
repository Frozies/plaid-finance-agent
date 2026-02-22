import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/connection';
import * as sync from '../services/sync';
import logger from '../services/logger';
import type { AccountWithInstitution, InstitutionWithCount, InstitutionRow } from '../types';

const router = Router();

interface AccountsQuery {
  type?: string;
  institution_id?: string;
}

router.get('/', (req: Request<unknown, unknown, unknown, AccountsQuery>, res: Response) => {
  const db = getDb();
  const { type, institution_id } = req.query;

  let query = `
    SELECT a.*, i.institution_name, i.status as institution_status
    FROM accounts a
    JOIN institutions i ON a.institution_id = i.id
    WHERE a.is_hidden = 0
  `;
  const params: string[] = [];

  if (type) {
    query += ' AND a.type = ?';
    params.push(type);
  }
  if (institution_id) {
    query += ' AND a.institution_id = ?';
    params.push(institution_id);
  }

  query += ' ORDER BY i.institution_name, a.type, a.name';

  const accounts = db.prepare(query).all(...params) as AccountWithInstitution[];
  res.json({ accounts });
});

interface BalancesQuery {
  refresh?: string;
  type?: string;
  account_type?: string;
}

router.get('/balances', async (req: Request<unknown, unknown, unknown, BalancesQuery>, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { refresh, type, account_type } = req.query;
    const filterType = type ?? account_type;

    if (refresh === 'true') {
      const institutions = db.prepare(
        'SELECT id FROM institutions WHERE status = ?'
      ).all('active') as Pick<InstitutionRow, 'id'>[];
      for (const inst of institutions) {
        try {
          await sync.syncBalances(inst.id);
        } catch (err) {
          logger.warn(`Balance refresh failed for ${inst.id}: ${(err as Error).message}`);
        }
      }
    }

    let query = `
      SELECT a.*, i.institution_name
      FROM accounts a
      JOIN institutions i ON a.institution_id = i.id
      WHERE a.is_hidden = 0
    `;
    const params: string[] = [];

    if (filterType) {
      query += ' AND a.type = ?';
      params.push(filterType);
    }

    query += ' ORDER BY a.type, a.current_balance DESC';

    const accounts = db.prepare(query).all(...params) as AccountWithInstitution[];

    const totals: Record<string, { count: number; total: number }> = {};
    let netWorth = 0;

    for (const acct of accounts) {
      const t = acct.type;
      if (!totals[t]) totals[t] = { count: 0, total: 0 };
      totals[t]!.count++;
      totals[t]!.total += acct.current_balance ?? 0;

      if (['depository', 'investment', 'brokerage'].includes(t)) {
        netWorth += acct.current_balance ?? 0;
      } else if (['credit', 'loan'].includes(t)) {
        netWorth -= Math.abs(acct.current_balance ?? 0);
      }
    }

    res.json({
      accounts: accounts.map((a) => ({
        id: a.plaid_account_id,
        name: a.name,
        institution: a.institution_name,
        type: a.type,
        subtype: a.subtype,
        mask: a.mask,
        current: a.current_balance,
        available: a.available_balance,
        limit: a.credit_limit,
        currency: a.currency,
        updated_at: a.updated_at,
      })),
      totals,
      net_worth: Math.round(netWorth * 100) / 100,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/institutions', (_req: Request, res: Response) => {
  const db = getDb();
  const institutions = db.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM accounts WHERE institution_id = i.id) as account_count
    FROM institutions i
    ORDER BY i.institution_name
  `).all() as InstitutionWithCount[];

  res.json({
    institutions: institutions.map((i) => ({
      id: i.id,
      name: i.institution_name,
      status: i.status,
      products: JSON.parse(i.products || '[]') as string[],
      account_count: i.account_count,
      last_synced: i.last_synced,
      linked_at: i.linked_at,
    })),
  });
});

router.delete('/institutions/:id', (req: Request<{ id: string }>, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(id) as InstitutionRow | undefined;
  if (!inst) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  db.prepare('DELETE FROM transactions WHERE institution_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE institution_id = ?').run(id);
  db.prepare('DELETE FROM institutions WHERE id = ?').run(id);

  logger.info(`Unlinked institution: ${inst.institution_name} (${id})`);
  res.json({ success: true, unlinked: inst.institution_name });
});

export default router;
