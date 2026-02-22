import { getDb } from '../db/connection';
import * as budget from './budget';
import logger from './logger';
import config from '../config';
import type {
  AlertRow,
  TriggeredAlert,
  LargeTransactionConfig,
  BudgetThresholdConfig,
  BalanceLowConfig,
  TransactionRow,
  AccountRow,
} from '../types';

interface TransactionWithAccount extends TransactionRow {
  account_name: string | null;
}

export function evaluateAlerts(): TriggeredAlert[] {
  const db = getDb();
  const alerts = db.prepare('SELECT * FROM alerts WHERE active = 1').all() as AlertRow[];
  const triggered: TriggeredAlert[] = [];

  for (const alert of alerts) {
    const alertConfig = JSON.parse(alert.config) as Record<string, unknown>;

    switch (alert.type) {
      case 'large_transaction':
        triggered.push(...checkLargeTransactions(alert, alertConfig as unknown as LargeTransactionConfig));
        break;
      case 'budget_threshold':
      case 'budget_exceeded':
        triggered.push(...checkBudgetThresholds(alert, alertConfig as unknown as BudgetThresholdConfig));
        break;
      case 'balance_low':
        triggered.push(...checkLowBalances(alert, alertConfig as unknown as BalanceLowConfig));
        break;
    }
  }

  return triggered;
}

function checkLargeTransactions(alert: AlertRow, alertConfig: LargeTransactionConfig): TriggeredAlert[] {
  const db = getDb();
  const since = alert.last_triggered ?? new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const txns = db.prepare(`
    SELECT t.*, a.name as account_name
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.plaid_account_id
    WHERE t.amount > ? AND t.created_at > ? AND t.pending = 0
    ORDER BY t.amount DESC
  `).all(alertConfig.threshold, since) as TransactionWithAccount[];

  if (txns.length > 0) {
    db.prepare('UPDATE alerts SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?').run(alert.id);
  }

  return txns.map((txn) => ({
    type: 'large_transaction',
    message: `🚨 Large transaction: $${txn.amount.toFixed(2)} at ${txn.merchant_name ?? txn.name} (${txn.account_name ?? 'Unknown'})`,
    data: txn,
  }));
}

function checkBudgetThresholds(alert: AlertRow, alertConfig: BudgetThresholdConfig): TriggeredAlert[] {
  const violations = budget.checkBudgetAlerts(alertConfig.percent);
  const results: TriggeredAlert[] = [];

  for (const v of violations) {
    const emoji = v.percent >= 100 ? '🔴' : '🟡';
    const status = v.percent >= 100 ? 'EXCEEDED' : `${v.percent}% used`;
    results.push({
      type: alert.type,
      message: `${emoji} Budget alert: ${v.category} — $${v.spent.toFixed(2)} / $${v.amount.toFixed(2)} (${status})`,
      data: v,
    });
  }

  if (results.length > 0) {
    const db = getDb();
    db.prepare('UPDATE alerts SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?').run(alert.id);
  }

  return results;
}

function checkLowBalances(alert: AlertRow, alertConfig: BalanceLowConfig): TriggeredAlert[] {
  const db = getDb();
  const results: TriggeredAlert[] = [];

  let query = `
    SELECT * FROM accounts
    WHERE current_balance IS NOT NULL AND current_balance < ?
  `;
  const params: (string | number)[] = [alertConfig.threshold];

  if (alertConfig.account_type) {
    query += ' AND type = ?';
    params.push(alertConfig.account_type);
  }

  const accounts = db.prepare(query).all(...params) as AccountRow[];

  for (const acct of accounts) {
    results.push({
      type: 'balance_low',
      message: `⚠️ Low balance: ${acct.name} — $${(acct.current_balance ?? 0).toFixed(2)} (threshold: $${alertConfig.threshold})`,
      data: acct,
    });
  }

  if (results.length > 0) {
    db.prepare('UPDATE alerts SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?').run(alert.id);
  }

  return results;
}

export async function dispatchAlerts(triggered: TriggeredAlert[]): Promise<TriggeredAlert[] | undefined> {
  if (triggered.length === 0) return;

  for (const alert of triggered) {
    logger.info(`ALERT: ${alert.message}`);
  }

  if (config.openclawWebhookUrl) {
    try {
      const response = await fetch(config.openclawWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'finance_alert',
          alerts: triggered.map((a) => ({ type: a.type, message: a.message })),
        }),
      });
      if (!response.ok) {
        logger.warn(`OpenClaw webhook returned ${response.status}`);
      }
    } catch (err) {
      logger.error(`Failed to dispatch alerts to OpenClaw: ${(err as Error).message}`);
    }
  }

  return triggered;
}
