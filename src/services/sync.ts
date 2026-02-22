import { getDb } from '../db/connection';
import * as plaid from './plaid';
import logger from './logger';
import type {
  InstitutionRow,
  SyncStats,
  SyncReauthResult,
  OverrideResult,
  CategoryOverrideRow,
} from '../types';

export async function syncInstitution(institutionId: string): Promise<SyncStats | SyncReauthResult | null> {
  const db = getDb();
  const inst = db.prepare(
    'SELECT * FROM institutions WHERE id = ? AND status = ?'
  ).get(institutionId, 'active') as InstitutionRow | undefined;

  if (!inst) {
    logger.warn(`Institution ${institutionId} not found or not active`);
    return null;
  }

  try {
    const accessToken = plaid.getAccessToken(institutionId);
    const result = await plaid.syncTransactions(accessToken, inst.cursor);

    const stats: SyncStats = { added: 0, modified: 0, removed: 0 };

    const upsert = db.prepare(`
      INSERT INTO transactions (id, institution_id, account_id, amount, currency, date, name,
        merchant_name, category_primary, category_detailed, personal_finance_category,
        custom_category, pending, is_business)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        amount = excluded.amount,
        date = excluded.date,
        name = excluded.name,
        merchant_name = excluded.merchant_name,
        category_primary = excluded.category_primary,
        category_detailed = excluded.category_detailed,
        personal_finance_category = excluded.personal_finance_category,
        pending = excluded.pending
    `);

    const upsertMany = db.transaction((transactions: typeof result.added) => {
      for (const txn of transactions) {
        const pfc = txn.personal_finance_category?.primary ?? null;
        const pfcDetailed = txn.personal_finance_category?.detailed ?? null;
        const { category: customCat, isBusiness } = applyOverrides(txn.merchant_name ?? txn.name);

        upsert.run(
          txn.transaction_id,
          institutionId,
          txn.account_id,
          txn.amount,
          txn.iso_currency_code ?? 'USD',
          txn.date,
          txn.name,
          txn.merchant_name ?? null,
          pfc,
          pfcDetailed,
          pfc,
          customCat,
          txn.pending ? 1 : 0,
          isBusiness ? 1 : 0
        );
      }
    });

    if (result.added.length > 0) {
      upsertMany(result.added);
      stats.added = result.added.length;
    }

    if (result.modified.length > 0) {
      upsertMany(result.modified);
      stats.modified = result.modified.length;
    }

    if (result.removed.length > 0) {
      const del = db.prepare('DELETE FROM transactions WHERE id = ?');
      const delMany = db.transaction((ids: typeof result.removed) => {
        for (const r of ids) {
          del.run(r.transaction_id);
        }
      });
      delMany(result.removed);
      stats.removed = result.removed.length;
    }

    db.prepare('UPDATE institutions SET cursor = ?, last_synced = CURRENT_TIMESTAMP WHERE id = ?')
      .run(result.cursor, institutionId);

    logger.info(`Synced ${institutionId} (${inst.institution_name}): +${stats.added} ~${stats.modified} -${stats.removed}`);
    return stats;

  } catch (err) {
    if (plaid.isReauthRequired(err)) {
      db.prepare('UPDATE institutions SET status = ? WHERE id = ?').run('pending_reauth', institutionId);
      logger.warn(`Institution ${institutionId} needs re-authentication`);
      return { error: 'ITEM_LOGIN_REQUIRED', institutionId };
    }
    logger.error(`Sync failed for ${institutionId}: ${(err as Error).message}`);
    throw err;
  }
}

export async function syncAll(): Promise<Record<string, SyncStats | SyncReauthResult | { error: string } | null>> {
  const db = getDb();
  const institutions = db.prepare(
    'SELECT id, institution_name FROM institutions WHERE status = ?'
  ).all('active') as Pick<InstitutionRow, 'id' | 'institution_name'>[];

  logger.info(`Starting sync for ${institutions.length} institution(s)`);
  const results: Record<string, SyncStats | SyncReauthResult | { error: string } | null> = {};

  for (const inst of institutions) {
    try {
      results[inst.id] = await syncInstitution(inst.id);
    } catch (err) {
      results[inst.id] = { error: (err as Error).message };
    }
  }

  return results;
}

export async function syncBalances(institutionId: string): Promise<plaid.TransactionSyncResult['added'] extends Array<infer _T> ? unknown[] : never> {
  const db = getDb();
  const accessToken = plaid.getAccessToken(institutionId);
  const data = await plaid.getBalances(accessToken);

  const upsert = db.prepare(`
    INSERT INTO accounts (id, institution_id, plaid_account_id, name, official_name,
      type, subtype, mask, current_balance, available_balance, credit_limit, currency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_account_id) DO UPDATE SET
      name = excluded.name,
      current_balance = excluded.current_balance,
      available_balance = excluded.available_balance,
      credit_limit = excluded.credit_limit,
      updated_at = CURRENT_TIMESTAMP
  `);

  const upsertMany = db.transaction((accounts: typeof data.accounts) => {
    for (const acct of accounts) {
      upsert.run(
        acct.account_id,
        institutionId,
        acct.account_id,
        acct.name,
        acct.official_name ?? null,
        acct.type,
        acct.subtype ?? null,
        acct.mask ?? null,
        acct.balances.current,
        acct.balances.available,
        acct.balances.limit ?? null,
        acct.balances.iso_currency_code ?? 'USD'
      );
    }
  });

  upsertMany(data.accounts);
  logger.info(`Updated balances for ${data.accounts.length} accounts from ${institutionId}`);
  return data.accounts;
}

export function applyOverrides(merchantName: string | null): OverrideResult {
  if (!merchantName) return { category: null, isBusiness: false };

  const db = getDb();
  const overrides = db.prepare('SELECT * FROM category_overrides').all() as CategoryOverrideRow[];

  const nameLower = merchantName.toLowerCase();

  for (const override of overrides) {
    let matches = false;

    switch (override.match_type) {
      case 'exact':
        matches = nameLower === override.merchant_pattern.toLowerCase();
        break;
      case 'contains':
        matches = nameLower.includes(override.merchant_pattern.toLowerCase());
        break;
      case 'regex':
        try {
          matches = new RegExp(override.merchant_pattern, 'i').test(merchantName);
        } catch {
          // Invalid regex, skip
        }
        break;
    }

    if (matches) {
      return {
        category: override.custom_category,
        isBusiness: override.scope === 'business',
      };
    }
  }

  return { category: null, isBusiness: false };
}
