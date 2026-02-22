// ─── Database Row Types ───

export interface InstitutionRow {
  id: string;
  plaid_item_id: string;
  institution_id: string | null;
  institution_name: string;
  encrypted_access_token: string;
  iv: string;
  auth_tag: string;
  products: string;
  status: string;
  cursor: string | null;
  linked_at: string;
  last_synced: string | null;
}

export interface AccountRow {
  id: string;
  institution_id: string;
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  currency: string;
  is_hidden: number;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  institution_id: string;
  account_id: string;
  amount: number;
  currency: string;
  date: string;
  name: string;
  merchant_name: string | null;
  category_primary: string | null;
  category_detailed: string | null;
  personal_finance_category: string | null;
  custom_category: string | null;
  pending: number;
  is_business: number;
  notes: string | null;
  created_at: string;
}

export interface TransactionJoinedRow extends TransactionRow {
  account_name: string | null;
  account_type: string | null;
  institution_name: string | null;
}

export interface BudgetRow {
  id: number;
  category: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
  scope: 'personal' | 'business' | 'all';
  active: number;
  created_at: string;
}

export interface SnapshotRow {
  id: number;
  date: string;
  type: 'balance' | 'investment';
  account_id: string;
  data: string;
  created_at: string;
}

export interface AlertRow {
  id: number;
  type: string;
  config: string;
  active: number;
  last_triggered: string | null;
  created_at: string;
}

export interface CategoryOverrideRow {
  id: number;
  merchant_pattern: string;
  match_type: 'exact' | 'contains' | 'regex';
  custom_category: string;
  scope: 'personal' | 'business';
  created_at: string;
}

export interface SchemaVersionRow {
  version: number;
  applied_at: string;
}

// ─── Config Type ───

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  plaid: {
    clientId: string;
    secret: string;
    env: PlaidEnv;
    baseUrl: string;
  };
  encryption: {
    key: Buffer;
  };
  bearerToken: string;
  webhookUrl: string | null;
  openclawWebhookUrl: string | null;
}

export type PlaidEnv = 'sandbox' | 'development' | 'production';

// ─── Crypto Types ───

export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

// ─── Sync Types ───

export interface SyncStats {
  added: number;
  modified: number;
  removed: number;
}

export interface SyncReauthResult {
  error: string;
  institutionId: string;
}

export interface OverrideResult {
  category: string | null;
  isBusiness: boolean;
}

// ─── Alert Types ───

export interface TriggeredAlert {
  type: string;
  message: string;
  data?: unknown;
}

export interface LargeTransactionConfig {
  threshold: number;
}

export interface BudgetThresholdConfig {
  percent: number;
}

export interface BalanceLowConfig {
  threshold: number;
  account_type?: string;
}

// ─── Budget Types ───

export interface BudgetStatus extends BudgetRow {
  spent: number;
  txn_count: number;
  remaining: number;
  percent: number;
  period_start: string;
}

export interface CreateBudgetInput {
  category: string;
  amount: number;
  period?: 'weekly' | 'monthly' | 'yearly';
  scope?: 'personal' | 'business' | 'all';
}

// ─── API Response Helpers ───

export interface CountResult {
  count: number;
}

export interface SpendingResult {
  total_spent: number;
  total_income: number;
  txn_count: number;
}

export interface WeeklySpendingResult {
  personal: number;
  business: number;
  total: number;
  txn_count: number;
}

export interface CategorySummary {
  category: string;
  total: number;
  count: number;
  avg_amount?: number;
}

export interface BudgetSpendingResult {
  total_spent: number;
  txn_count: number;
}

export interface SnapshotAggregateRow {
  date: string;
  total_value: number;
}

export interface InstitutionWithCount extends InstitutionRow {
  account_count: number;
}

export interface AccountWithInstitution extends AccountRow {
  institution_name: string;
  institution_status?: string;
}
