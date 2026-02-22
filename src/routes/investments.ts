import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/connection';
import * as plaid from '../services/plaid';
import logger from '../services/logger';
import type { InstitutionRow, SnapshotAggregateRow } from '../types';

const router = Router();

interface InvestmentsQuery {
  refresh?: string;
}

interface InvestmentAccount {
  id: string;
  name: string;
  institution: string;
  balance: number | null;
  currency: string;
}

interface InvestmentHolding {
  account_id: string;
  security_id: string;
  name: string;
  ticker: string | null;
  type: string | null;
  quantity: number;
  price: number;
  price_date: string | null;
  value: number;
  cost_basis: number | null;
  currency: string;
  gain_loss: number | null;
  gain_loss_pct: number | null;
}

router.get('/', async (req: Request<unknown, unknown, unknown, InvestmentsQuery>, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { refresh = 'false' } = req.query;

    const institutions = db.prepare(`
      SELECT * FROM institutions
      WHERE status = 'active' AND products LIKE '%investments%'
    `).all() as InstitutionRow[];

    if (institutions.length === 0) {
      res.json({
        message: 'No investment accounts linked. Link a brokerage account to get started.',
        accounts: [],
        holdings: [],
        total_value: 0,
      });
      return;
    }

    const allAccounts: InvestmentAccount[] = [];
    const allHoldings: InvestmentHolding[] = [];
    let totalValue = 0;

    for (const inst of institutions) {
      try {
        const accessToken = plaid.getAccessToken(inst.id);
        const data = await plaid.getInvestments(accessToken);

        const securities: Record<string, (typeof data.securities)[number]> = {};
        for (const sec of data.securities ?? []) {
          securities[sec.security_id] = sec;
        }

        for (const acct of data.accounts ?? []) {
          if (acct.type === 'investment' || acct.type === 'brokerage') {
            allAccounts.push({
              id: acct.account_id,
              name: acct.name,
              institution: inst.institution_name,
              balance: acct.balances.current,
              currency: acct.balances.iso_currency_code ?? 'USD',
            });
            totalValue += acct.balances.current ?? 0;
          }
        }

        for (const holding of data.holdings ?? []) {
          const security = securities[holding.security_id];
          allHoldings.push({
            account_id: holding.account_id,
            security_id: holding.security_id,
            name: security?.name ?? 'Unknown',
            ticker: security?.ticker_symbol ?? null,
            type: security?.type ?? null,
            quantity: holding.quantity,
            price: holding.institution_price,
            price_date: holding.institution_price_as_of ?? null,
            value: holding.institution_value,
            cost_basis: holding.cost_basis,
            currency: holding.iso_currency_code ?? 'USD',
            gain_loss: holding.cost_basis
              ? Math.round((holding.institution_value - holding.cost_basis) * 100) / 100
              : null,
            gain_loss_pct: holding.cost_basis && holding.cost_basis > 0
              ? Math.round(((holding.institution_value - holding.cost_basis) / holding.cost_basis) * 10000) / 100
              : null,
          });
        }

        if (refresh === 'true') {
          const today = new Date().toISOString().split('T')[0]!;
          for (const acct of data.accounts ?? []) {
            if (acct.type === 'investment' || acct.type === 'brokerage') {
              db.prepare(`
                INSERT OR REPLACE INTO snapshots (date, type, account_id, data)
                VALUES (?, 'investment', ?, ?)
              `).run(today, acct.account_id, JSON.stringify({
                value: acct.balances.current,
                institution: inst.institution_name,
                name: acct.name,
              }));
            }
          }
        }

      } catch (err) {
        logger.error(`Investment fetch failed for ${inst.institution_name}: ${(err as Error).message}`);
        if (plaid.isReauthRequired(err)) {
          db.prepare('UPDATE institutions SET status = ? WHERE id = ?').run('pending_reauth', inst.id);
        }
      }
    }

    allHoldings.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    res.json({
      accounts: allAccounts,
      holdings: allHoldings,
      total_value: Math.round(totalValue * 100) / 100,
      holding_count: allHoldings.length,
    });
  } catch (err) {
    next(err);
  }
});

interface PerformanceQuery {
  days?: string;
}

router.get('/performance', (req: Request<unknown, unknown, unknown, PerformanceQuery>, res: Response) => {
  const db = getDb();
  const { days = '30' } = req.query;

  const startDate = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]!;

  const snapshots = db.prepare(`
    SELECT date, SUM(json_extract(data, '$.value')) as total_value
    FROM snapshots
    WHERE type = 'investment' AND date >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(startDate) as SnapshotAggregateRow[];

  if (snapshots.length < 2) {
    res.json({
      message: 'Not enough data yet. Snapshots are taken daily.',
      data_points: snapshots,
    });
    return;
  }

  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const change = last.total_value - first.total_value;
  const changePct = first.total_value > 0
    ? Math.round((change / first.total_value) * 10000) / 100
    : 0;

  res.json({
    period: { start: first.date, end: last.date, days: parseInt(days, 10) },
    start_value: first.total_value,
    current_value: last.total_value,
    change: Math.round(change * 100) / 100,
    change_pct: changePct,
    data_points: snapshots,
  });
});

export default router;
