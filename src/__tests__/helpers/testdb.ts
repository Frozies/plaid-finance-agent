import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const SCHEMA_PATH = path.join(__dirname, '../../db/schema.sql');

/**
 * Creates a fresh in-memory SQLite database with the full schema applied.
 * Use this in tests that need database access.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  return db;
}

/**
 * Seeds the test database with sample data for integration tests.
 */
export function seedTestData(db: Database.Database): void {
  // Institution
  db.prepare(`
    INSERT INTO institutions (id, plaid_item_id, institution_id, institution_name,
      encrypted_access_token, iv, auth_tag, products, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'inst_001', 'item_abc123', 'ins_plaid_001', 'Test Bank',
    'encrypted_token_data', 'aabbccdd', 'eeff0011', '["transactions"]', 'active'
  );

  // Accounts
  db.prepare(`
    INSERT INTO accounts (id, institution_id, plaid_account_id, name, type, subtype,
      current_balance, available_balance, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('acct_001', 'inst_001', 'acct_001', 'Checking', 'depository', 'checking', 5000, 4800, 'USD');

  db.prepare(`
    INSERT INTO accounts (id, institution_id, plaid_account_id, name, type, subtype,
      current_balance, available_balance, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('acct_002', 'inst_001', 'acct_002', 'Credit Card', 'credit', 'credit card', -1200, null, 'USD');

  // Transactions
  const insertTxn = db.prepare(`
    INSERT INTO transactions (id, institution_id, account_id, amount, currency, date, name,
      merchant_name, personal_finance_category, pending, is_business)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const today = new Date().toISOString().split('T')[0]!;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;

  insertTxn.run('txn_001', 'inst_001', 'acct_001', 45.99, 'USD', today, 'Grocery Store', 'Whole Foods', 'FOOD_AND_DRINK', 0, 0);
  insertTxn.run('txn_002', 'inst_001', 'acct_001', 12.50, 'USD', today, 'Coffee Shop', 'Starbucks', 'FOOD_AND_DRINK', 0, 0);
  insertTxn.run('txn_003', 'inst_001', 'acct_002', 250.00, 'USD', yesterday, 'Office Supplies', 'Staples', 'GENERAL_MERCHANDISE', 0, 1);
  insertTxn.run('txn_004', 'inst_001', 'acct_001', -2500.00, 'USD', yesterday, 'Payroll', null, 'INCOME', 0, 0);
  insertTxn.run('txn_005', 'inst_001', 'acct_001', 600.00, 'USD', today, 'Big Purchase', 'Best Buy', 'GENERAL_MERCHANDISE', 0, 0);

  // Budgets
  db.prepare(`
    INSERT INTO budgets (category, amount, period, scope) VALUES (?, ?, ?, ?)
  `).run('FOOD_AND_DRINK', 500, 'monthly', 'personal');

  db.prepare(`
    INSERT INTO budgets (category, amount, period, scope) VALUES (?, ?, ?, ?)
  `).run('GENERAL_MERCHANDISE', 200, 'monthly', 'all');

  // Category overrides
  db.prepare(`
    INSERT INTO category_overrides (merchant_pattern, match_type, custom_category, scope)
    VALUES (?, ?, ?, ?)
  `).run('Starbucks', 'contains', 'Coffee', 'personal');

  db.prepare(`
    INSERT INTO category_overrides (merchant_pattern, match_type, custom_category, scope)
    VALUES (?, ?, ?, ?)
  `).run('Staples', 'exact', 'Office', 'business');
}
