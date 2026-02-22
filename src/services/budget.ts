import { getDb } from '../db/connection';
import type {
  BudgetRow,
  BudgetStatus,
  BudgetSpendingResult,
  CreateBudgetInput,
} from '../types';

export function getPeriodStart(period: string, referenceDate: Date = new Date()): string {
  const d = new Date(referenceDate);
  switch (period) {
    case 'weekly': {
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      break;
    }
    case 'monthly':
      d.setDate(1);
      break;
    case 'yearly':
      d.setMonth(0, 1);
      break;
  }
  return d.toISOString().split('T')[0]!;
}

export function getBudgetSpending(budget: BudgetRow): BudgetStatus {
  const db = getDb();
  const periodStart = getPeriodStart(budget.period);
  const today = new Date().toISOString().split('T')[0]!;

  let scopeFilter = '';
  if (budget.scope === 'personal') {
    scopeFilter = 'AND is_business = 0';
  } else if (budget.scope === 'business') {
    scopeFilter = 'AND is_business = 1';
  }

  const result = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_spent, COUNT(*) as txn_count
    FROM transactions
    WHERE date >= ? AND date <= ?
      AND pending = 0
      AND amount > 0
      AND (
        personal_finance_category LIKE ? OR
        category_primary LIKE ? OR
        custom_category LIKE ?
      )
      ${scopeFilter}
  `).get(
    periodStart,
    today,
    `%${budget.category}%`,
    `%${budget.category}%`,
    `%${budget.category}%`
  ) as BudgetSpendingResult;

  return {
    ...budget,
    spent: Math.round(result.total_spent * 100) / 100,
    txn_count: result.txn_count,
    remaining: Math.round((budget.amount - result.total_spent) * 100) / 100,
    percent: Math.round((result.total_spent / budget.amount) * 100),
    period_start: periodStart,
  };
}

export function getAllBudgetStatus(): BudgetStatus[] {
  const db = getDb();
  const budgets = db.prepare('SELECT * FROM budgets WHERE active = 1').all() as BudgetRow[];
  return budgets.map(getBudgetSpending);
}

export function checkBudgetAlerts(thresholdPercent: number = 80): BudgetStatus[] {
  const statuses = getAllBudgetStatus();
  return statuses.filter((b) => b.percent >= thresholdPercent);
}

export function createBudget({ category, amount, period = 'monthly', scope = 'personal' }: CreateBudgetInput): {
  id: number;
  category: string;
  amount: number;
  period: string;
  scope: string;
} {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO budgets (category, amount, period, scope) VALUES (?, ?, ?, ?)'
  ).run(category, amount, period, scope);

  return { id: Number(result.lastInsertRowid), category, amount, period, scope };
}

export function updateBudget(id: number, updates: Record<string, unknown>): BudgetRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (['category', 'amount', 'period', 'scope', 'active'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  db.prepare(`UPDATE budgets SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as BudgetRow | undefined ?? null;
}

export function deleteBudget(id: number): Database.RunResult {
  const db = getDb();
  return db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
}

// Import the type for RunResult
import type Database from 'better-sqlite3';
