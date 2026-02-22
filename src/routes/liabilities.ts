import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/connection';
import * as plaid from '../services/plaid';
import logger from '../services/logger';
import type { InstitutionRow } from '../types';

const router = Router();

interface CreditEntry {
  account_id: string | null;
  account_name: string;
  institution: string;
  balance: number;
  limit: number | null;
  utilization: number | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  minimum_payment: number | null;
  next_payment_due: string | null;
  aprs: Array<{ type: string; rate: number; balance: number | null }>;
}

interface StudentLoanEntry {
  account_id: string | null;
  account_name: string;
  institution: string;
  balance: number;
  origination_principal: number | null;
  interest_rate: number | null;
  minimum_payment: number | null;
  next_payment_due: string | null;
  loan_status: string | null;
  expected_payoff: string | null;
}

interface MortgageEntry {
  account_id: string | null;
  account_name: string;
  institution: string;
  balance: number;
  original_principal: number | null;
  interest_rate: number | null;
  interest_type: string | null;
  next_payment_due: string | null;
  next_payment_amount: number | null;
  maturity_date: string | null;
  property_address: unknown;
}

interface LiabilitiesResult {
  credit: CreditEntry[];
  student: StudentLoanEntry[];
  mortgage: MortgageEntry[];
  total_owed: number;
  message?: string;
}

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    const institutions = db.prepare(`
      SELECT * FROM institutions
      WHERE status = 'active' AND products LIKE '%liabilities%'
    `).all() as InstitutionRow[];

    if (institutions.length === 0) {
      res.json({
        message: 'No liability accounts linked.',
        credit: [],
        student: [],
        mortgage: [],
        total_owed: 0,
      } satisfies LiabilitiesResult);
      return;
    }

    const result: LiabilitiesResult = {
      credit: [],
      student: [],
      mortgage: [],
      total_owed: 0,
    };

    for (const inst of institutions) {
      try {
        const accessToken = plaid.getAccessToken(inst.id);
        const data = await plaid.getLiabilities(accessToken);

        for (const cc of data.liabilities?.credit ?? []) {
          const acct = data.accounts?.find((a) => a.account_id === cc.account_id);
          const entry: CreditEntry = {
            account_id: cc.account_id,
            account_name: acct?.name ?? 'Unknown',
            institution: inst.institution_name,
            balance: acct?.balances?.current ?? 0,
            limit: acct?.balances?.limit ?? null,
            utilization: acct?.balances?.limit
              ? Math.round(((acct.balances.current ?? 0) / acct.balances.limit) * 100)
              : null,
            last_payment_amount: cc.last_payment_amount,
            last_payment_date: cc.last_payment_date,
            minimum_payment: cc.minimum_payment_amount,
            next_payment_due: cc.next_payment_due_date,
            aprs: cc.aprs?.map((a) => ({
              type: a.apr_type,
              rate: a.apr_percentage,
              balance: a.balance_subject_to_apr,
            })) ?? [],
          };
          result.credit.push(entry);
          result.total_owed += entry.balance;
        }

        for (const loan of data.liabilities?.student ?? []) {
          const acct = data.accounts?.find((a) => a.account_id === loan.account_id);
          const entry: StudentLoanEntry = {
            account_id: loan.account_id,
            account_name: acct?.name ?? 'Unknown',
            institution: inst.institution_name,
            balance: acct?.balances?.current ?? 0,
            origination_principal: loan.origination_principal_amount,
            interest_rate: loan.interest_rate_percentage,
            minimum_payment: loan.minimum_payment_amount,
            next_payment_due: loan.next_payment_due_date,
            loan_status: loan.loan_status?.type ?? null,
            expected_payoff: loan.expected_payoff_date,
          };
          result.student.push(entry);
          result.total_owed += entry.balance;
        }

        for (const mortgage of data.liabilities?.mortgage ?? []) {
          const acct = data.accounts?.find((a) => a.account_id === mortgage.account_id);
          const entry: MortgageEntry = {
            account_id: mortgage.account_id,
            account_name: acct?.name ?? 'Unknown',
            institution: inst.institution_name,
            balance: acct?.balances?.current ?? 0,
            original_principal: mortgage.origination_principal_amount,
            interest_rate: mortgage.interest_rate?.percentage ?? null,
            interest_type: mortgage.interest_rate?.type ?? null,
            next_payment_due: mortgage.next_payment_due_date,
            next_payment_amount: mortgage.next_monthly_payment,
            maturity_date: mortgage.maturity_date,
            property_address: mortgage.property_address,
          };
          result.mortgage.push(entry);
          result.total_owed += entry.balance;
        }

      } catch (err) {
        logger.error(`Liabilities fetch failed for ${inst.institution_name}: ${(err as Error).message}`);
        if (plaid.isReauthRequired(err)) {
          db.prepare('UPDATE institutions SET status = ? WHERE id = ?').run('pending_reauth', inst.id);
        }
      }
    }

    result.total_owed = Math.round(result.total_owed * 100) / 100;

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
