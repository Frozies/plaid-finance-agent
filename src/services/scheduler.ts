import cron from 'node-cron';
import * as sync from './sync';
import * as alerts from './alerts';
import { getDb } from '../db/connection';
import logger from './logger';
import type {
  InstitutionRow,
  AccountRow,
  WeeklySpendingResult,
  CategorySummary,
} from '../types';

export function startScheduler(): void {
  logger.info('Starting scheduler...');

  // Transaction sync — every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    logger.info('[CRON] Starting transaction sync');
    try {
      const results = await sync.syncAll();
      logger.info(`[CRON] Sync complete: ${JSON.stringify(results)}`);
    } catch (err) {
      logger.error(`[CRON] Sync failed: ${(err as Error).message}`);
    }
  });

  // Balance sync — every 4 hours (offset by 30 min from transaction sync)
  cron.schedule('30 */4 * * *', async () => {
    logger.info('[CRON] Starting balance sync');
    try {
      const db = getDb();
      const institutions = db.prepare(
        'SELECT id FROM institutions WHERE status = ?'
      ).all('active') as Pick<InstitutionRow, 'id'>[];
      for (const inst of institutions) {
        await sync.syncBalances(inst.id);
      }
    } catch (err) {
      logger.error(`[CRON] Balance sync failed: ${(err as Error).message}`);
    }
  });

  // Daily balance snapshot — 6 AM ET
  cron.schedule('0 6 * * *', async () => {
    logger.info('[CRON] Taking daily balance snapshot');
    try {
      const db = getDb();
      const today = new Date().toISOString().split('T')[0]!;
      const accounts = db.prepare(
        'SELECT * FROM accounts WHERE is_hidden = 0'
      ).all() as AccountRow[];

      const insert = db.prepare(`
        INSERT OR REPLACE INTO snapshots (date, type, account_id, data)
        VALUES (?, 'balance', ?, ?)
      `);

      for (const acct of accounts) {
        insert.run(today, acct.plaid_account_id, JSON.stringify({
          current: acct.current_balance,
          available: acct.available_balance,
          limit: acct.credit_limit,
          name: acct.name,
          type: acct.type,
        }));
      }

      logger.info(`[CRON] Snapshot saved for ${accounts.length} accounts`);
    } catch (err) {
      logger.error(`[CRON] Snapshot failed: ${(err as Error).message}`);
    }
  });

  // Budget & alert check — 8 PM ET
  cron.schedule('0 20 * * *', async () => {
    logger.info('[CRON] Checking alerts');
    try {
      const triggered = alerts.evaluateAlerts();
      if (triggered.length > 0) {
        await alerts.dispatchAlerts(triggered);
        logger.info(`[CRON] ${triggered.length} alert(s) triggered`);
      } else {
        logger.info('[CRON] No alerts triggered');
      }
    } catch (err) {
      logger.error(`[CRON] Alert check failed: ${(err as Error).message}`);
    }
  });

  // Stale account check — 9 AM daily
  cron.schedule('0 9 * * *', async () => {
    logger.info('[CRON] Checking for stale institutions');
    try {
      const db = getDb();
      const stale = db.prepare(
        "SELECT * FROM institutions WHERE status = 'pending_reauth'"
      ).all() as InstitutionRow[];
      if (stale.length > 0) {
        const names = stale.map((i) => i.institution_name).join(', ');
        await alerts.dispatchAlerts([{
          type: 'reauth_needed',
          message: `⚠️ Re-authentication needed: ${names}`,
        }]);
      }
    } catch (err) {
      logger.error(`[CRON] Stale check failed: ${(err as Error).message}`);
    }
  });

  // Weekly summary — Sunday 7 PM
  cron.schedule('0 19 * * 0', async () => {
    logger.info('[CRON] Generating weekly summary');
    try {
      await generateWeeklySummary();
    } catch (err) {
      logger.error(`[CRON] Weekly summary failed: ${(err as Error).message}`);
    }
  });

  logger.info('Scheduler started with 6 cron jobs');
}

interface WeeklySummaryResult {
  period: string;
  spending: WeeklySpendingResult;
  top_categories: CategorySummary[];
}

export async function generateWeeklySummary(): Promise<WeeklySummaryResult> {
  const db = getDb();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startDate = weekAgo.toISOString().split('T')[0]!;
  const endDate = now.toISOString().split('T')[0]!;

  const spending = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN is_business = 0 THEN amount END), 0) as personal,
      COALESCE(SUM(CASE WHEN is_business = 1 THEN amount END), 0) as business,
      COALESCE(SUM(amount), 0) as total,
      COUNT(*) as txn_count
    FROM transactions
    WHERE date >= ? AND date <= ? AND amount > 0 AND pending = 0
  `).get(startDate, endDate) as WeeklySpendingResult;

  const categories = db.prepare(`
    SELECT
      COALESCE(custom_category, personal_finance_category, 'Uncategorized') as category,
      SUM(amount) as total,
      COUNT(*) as count
    FROM transactions
    WHERE date >= ? AND date <= ? AND amount > 0 AND pending = 0
    GROUP BY category
    ORDER BY total DESC
    LIMIT 10
  `).all(startDate, endDate) as CategorySummary[];

  const summary: WeeklySummaryResult = {
    period: `${startDate} to ${endDate}`,
    spending,
    top_categories: categories,
  };

  let message = `📊 Weekly Summary (${startDate} → ${endDate})\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💰 Total Spent: $${spending.total.toFixed(2)} (${spending.txn_count} transactions)\n`;
  message += `👤 Personal: $${spending.personal.toFixed(2)}\n`;
  message += `💼 Business: $${spending.business.toFixed(2)}\n\n`;
  message += `Top Categories:\n`;

  for (const cat of categories) {
    message += `  ${cat.category}: $${cat.total.toFixed(2)} (${cat.count}x)\n`;
  }

  await alerts.dispatchAlerts([{ type: 'weekly_summary', message }]);
  return summary;
}
