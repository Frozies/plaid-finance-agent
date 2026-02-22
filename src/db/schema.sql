-- Plaid Finance Agent Schema v1

-- Linked financial institutions
CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY,
    plaid_item_id TEXT UNIQUE NOT NULL,
    institution_id TEXT,
    institution_name TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    products TEXT NOT NULL DEFAULT '[]',
    status TEXT DEFAULT 'active',
    cursor TEXT,
    linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_synced DATETIME
);

-- Plaid accounts (checking, savings, credit, brokerage, etc.)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    plaid_account_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    official_name TEXT,
    type TEXT NOT NULL,
    subtype TEXT,
    mask TEXT,
    current_balance REAL,
    available_balance REAL,
    credit_limit REAL,
    currency TEXT DEFAULT 'USD',
    is_hidden BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
);

-- Cached transactions (synced incrementally via cursor)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    merchant_name TEXT,
    category_primary TEXT,
    category_detailed TEXT,
    personal_finance_category TEXT,
    custom_category TEXT,
    pending BOOLEAN DEFAULT 0,
    is_business BOOLEAN DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
);

-- Budget definitions
CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    period TEXT DEFAULT 'monthly' CHECK(period IN ('weekly', 'monthly', 'yearly')),
    scope TEXT DEFAULT 'personal' CHECK(scope IN ('personal', 'business', 'all')),
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily balance & portfolio snapshots
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('balance', 'investment')),
    account_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, type, account_id)
);

-- Alert rules
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    active BOOLEAN DEFAULT 1,
    last_triggered DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Category overrides (auto-tag merchants)
CREATE TABLE IF NOT EXISTS category_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_pattern TEXT NOT NULL,
    match_type TEXT DEFAULT 'contains' CHECK(match_type IN ('exact', 'contains', 'regex')),
    custom_category TEXT NOT NULL,
    scope TEXT DEFAULT 'personal' CHECK(scope IN ('personal', 'business')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_pattern, scope)
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(personal_finance_category);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business ON transactions(is_business);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_name);
CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions(pending);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(date, type);
CREATE INDEX IF NOT EXISTS idx_accounts_institution ON accounts(institution_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

-- Default alerts
INSERT OR IGNORE INTO alerts (id, type, config) VALUES
    (1, 'large_transaction', '{"threshold": 500}'),
    (2, 'budget_threshold', '{"percent": 80}'),
    (3, 'budget_exceeded', '{"percent": 100}'),
    (4, 'balance_low', '{"account_type": "checking", "threshold": 1000}');

-- Initial schema version
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
