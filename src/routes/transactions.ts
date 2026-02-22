import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/connection';
import * as sync from '../services/sync';
import logger from '../services/logger';
import type {
  TransactionJoinedRow,
  TransactionRow,
  CountResult,
  SpendingResult,
  CategorySummary,
} from '../types';

const router = Router();

interface TransactionsQuery {
  start?: string;
  end?: string;
  category?: string;
  merchant?: string;
  account_id?: string;
  scope?: string;
  min_amount?: string;
  max_amount?: string;
  search?: string;
  limit?: string;
  offset?: string;
  pending?: string;
}

router.get('/', (req: Request<unknown, unknown, unknown, TransactionsQuery>, res: Response) => {
  const db = getDb();
  const {
    start,
    end,
    category,
    merchant,
    account_id,
    scope = 'personal',
    min_amount,
    max_amount,
    search,
    limit = '100',
    offset = '0',
    pending = 'false',
  } = req.query;

  const today = new Date().toISOString().split('T')[0]!;
  const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

  let query = `
    SELECT t.*, a.name as account_name, a.type as account_type, i.institution_name
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.plaid_account_id
    LEFT JOIN institutions i ON t.institution_id = i.id
    WHERE t.date >= ? AND t.date <= ?
  `;
  const params: (string | number)[] = [start ?? defaultStart, end ?? today];

  if (scope === 'personal') {
    query += ' AND t.is_business = 0';
  } else if (scope === 'business') {
    query += ' AND t.is_business = 1';
  }

  if (pending !== 'true') {
    query += ' AND t.pending = 0';
  }

  if (category) {
    query += ' AND (t.personal_finance_category LIKE ? OR t.custom_category LIKE ? OR t.category_primary LIKE ?)';
    params.push(`%${category}%`, `%${category}%`, `%${category}%`);
  }

  if (merchant) {
    query += ' AND (t.merchant_name LIKE ? OR t.name LIKE ?)';
    params.push(`%${merchant}%`, `%${merchant}%`);
  }

  if (account_id) {
    query += ' AND t.account_id = ?';
    params.push(account_id);
  }

  if (min_amount) {
    query += ' AND t.amount >= ?';
    params.push(parseFloat(min_amount));
  }

  if (max_amount) {
    query += ' AND t.amount <= ?';
    params.push(parseFloat(max_amount));
  }

  if (search) {
    query += ' AND (t.name LIKE ? OR t.merchant_name LIKE ? OR t.personal_finance_category LIKE ? OR t.custom_category LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as count FROM');
  const total = (db.prepare(countQuery).get(...params) as CountResult).count;

  query += ' ORDER BY t.date DESC, t.amount DESC';
  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit, 10), parseInt(offset, 10));

  const transactions = db.prepare(query).all(...params) as TransactionJoinedRow[];

  res.json({
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      name: t.name,
      merchant: t.merchant_name,
      category: t.custom_category ?? t.personal_finance_category ?? 'Uncategorized',
      account: t.account_name,
      account_type: t.account_type,
      institution: t.institution_name,
      is_business: !!t.is_business,
      pending: !!t.pending,
      notes: t.notes,
    })),
    total,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
});

interface SummaryQuery {
  period?: string;
  start?: string;
  end?: string;
  scope?: string;
  compare?: string;
}

router.get('/summary', (req: Request<unknown, unknown, unknown, SummaryQuery>, res: Response) => {
  const db = getDb();
  const { period = 'current_month', start, end, scope = 'personal', compare } = req.query;

  const { startDate, endDate } = resolvePeriod(period, start, end);

  const scopeFilter = scope === 'personal' ? 'AND is_business = 0'
    : scope === 'business' ? 'AND is_business = 1' : '';

  const categories = db.prepare(`
    SELECT
      COALESCE(custom_category, personal_finance_category, 'Uncategorized') as category,
      SUM(amount) as total,
      COUNT(*) as count,
      AVG(amount) as avg_amount
    FROM transactions
    WHERE date >= ? AND date <= ?
      AND amount > 0 AND pending = 0
      ${scopeFilter}
    GROUP BY category
    ORDER BY total DESC
  `).all(startDate, endDate) as CategorySummary[];

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) as total_spent,
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) END), 0) as total_income,
      COUNT(*) as txn_count
    FROM transactions
    WHERE date >= ? AND date <= ? AND pending = 0
      ${scopeFilter}
  `).get(startDate, endDate) as SpendingResult;

  const result: {
    period: { start: string; end: string; label: string };
    totals: SpendingResult;
    categories: CategorySummary[];
    comparison?: {
      period: { start: string; end: string };
      totals: SpendingResult;
      spending_change: number;
      spending_change_pct: number | null;
    };
  } = {
    period: { start: startDate, end: endDate, label: period },
    totals,
    categories,
  };

  if (compare === 'previous') {
    const daysDiff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(new Date(startDate).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
    const prevStart = new Date(new Date(prevEnd).getTime() - daysDiff * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

    const prevTotals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) as total_spent,
        COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) END), 0) as total_income,
        COUNT(*) as txn_count
      FROM transactions
      WHERE date >= ? AND date <= ? AND pending = 0
        ${scopeFilter}
    `).get(prevStart, prevEnd) as SpendingResult;

    result.comparison = {
      period: { start: prevStart, end: prevEnd },
      totals: prevTotals,
      spending_change: totals.total_spent - prevTotals.total_spent,
      spending_change_pct: prevTotals.total_spent > 0
        ? Math.round(((totals.total_spent - prevTotals.total_spent) / prevTotals.total_spent) * 100)
        : null,
    };
  }

  res.json(result);
});

interface TagBody {
  is_business?: boolean;
  custom_category?: string;
  notes?: string;
}

router.post('/:id/tag', (req: Request<{ id: string }, unknown, TagBody>, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { is_business, custom_category, notes } = req.body;

  const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
  if (!txn) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (is_business !== undefined) {
    updates.push('is_business = ?');
    params.push(is_business ? 1 : 0);
  }
  if (custom_category !== undefined) {
    updates.push('custom_category = ?');
    params.push(custom_category);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    params.push(notes);
  }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow;
  res.json({ success: true, transaction: updated });
});

interface SyncBody {
  institution_id?: string;
}

router.post('/sync', async (req: Request<unknown, unknown, SyncBody>, res: Response, next: NextFunction) => {
  try {
    const { institution_id } = req.body;

    let results;
    if (institution_id) {
      results = { [institution_id]: await sync.syncInstitution(institution_id) };
    } else {
      results = await sync.syncAll();
    }

    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

interface CategoryOverrideRow {
  id: number;
  merchant_pattern: string;
  match_type: string;
  custom_category: string;
  scope: string;
  created_at: string;
}

router.get('/overrides', (_req: Request, res: Response) => {
  const db = getDb();
  const overrides = db.prepare(
    'SELECT * FROM category_overrides ORDER BY merchant_pattern'
  ).all() as CategoryOverrideRow[];
  res.json({ overrides });
});

interface CreateOverrideBody {
  merchant_pattern?: string;
  match_type?: string;
  custom_category?: string;
  scope?: string;
}

router.post('/overrides', (req: Request<unknown, unknown, CreateOverrideBody>, res: Response) => {
  const db = getDb();
  const { merchant_pattern, match_type = 'contains', custom_category, scope = 'personal' } = req.body;

  if (!merchant_pattern || !custom_category) {
    res.status(400).json({ error: 'merchant_pattern and custom_category are required' });
    return;
  }

  try {
    db.prepare(`
      INSERT INTO category_overrides (merchant_pattern, match_type, custom_category, scope)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(merchant_pattern, scope) DO UPDATE SET
        custom_category = excluded.custom_category,
        match_type = excluded.match_type
    `).run(merchant_pattern, match_type, custom_category, scope);

    const txns = db.prepare(`
      SELECT id, merchant_name, name FROM transactions
      WHERE merchant_name LIKE ? OR name LIKE ?
    `).all(`%${merchant_pattern}%`, `%${merchant_pattern}%`) as Pick<TransactionRow, 'id' | 'merchant_name' | 'name'>[];

    let retagged = 0;
    for (const txn of txns) {
      const result = sync.applyOverrides(txn.merchant_name ?? txn.name);
      if (result.category || result.isBusiness) {
        db.prepare('UPDATE transactions SET custom_category = ?, is_business = ? WHERE id = ?')
          .run(result.category, result.isBusiness ? 1 : 0, txn.id);
        retagged++;
      }
    }

    logger.info(`Category override created: "${merchant_pattern}" → ${custom_category} (${scope}), retagged ${retagged} existing transactions`);
    res.json({ success: true, retagged });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/overrides/:id', (req: Request<{ id: string }>, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM category_overrides WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

function resolvePeriod(period: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  const now = new Date();
  let startDate: string;
  let endDate: string;

  switch (period) {
    case 'current_week': {
      const day = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - day);
      startDate = weekStart.toISOString().split('T')[0]!;
      endDate = now.toISOString().split('T')[0]!;
      break;
    }
    case 'last_month': {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      startDate = lastMonth.toISOString().split('T')[0]!;
      endDate = lastDay.toISOString().split('T')[0]!;
      break;
    }
    case 'custom':
      startDate = customStart!;
      endDate = customEnd ?? now.toISOString().split('T')[0]!;
      break;
    case 'current_month':
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
      endDate = now.toISOString().split('T')[0]!;
      break;
  }

  return { startDate, endDate };
}

export default router;
