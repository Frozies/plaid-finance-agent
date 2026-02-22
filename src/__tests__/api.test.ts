import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from './helpers/testdb';

// Set up test database before importing app modules
let testDb: Database.Database;

vi.mock('../db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => testDb?.close(),
}));

// Mock the scheduler so it doesn't start cron jobs
vi.mock('../services/scheduler', () => ({
  startScheduler: vi.fn(),
}));

// Mock the plaid service to avoid real API calls
vi.mock('../services/plaid', () => ({
  getAccessToken: vi.fn().mockReturnValue('fake-access-token'),
  syncTransactions: vi.fn().mockResolvedValue({ added: [], modified: [], removed: [], cursor: 'next' }),
  getBalances: vi.fn().mockResolvedValue({ accounts: [] }),
  isReauthRequired: vi.fn().mockReturnValue(false),
}));

// Now import app and supertest
import request from 'supertest';
import app from '../index';

const AUTH_HEADER = `Bearer ${process.env['BEARER_TOKEN']!}`;

describe('API endpoints', () => {
  beforeAll(() => {
    testDb = createTestDb();
    seedTestData(testDb);
  });

  afterAll(() => {
    testDb?.close();
  });

  describe('GET /health', () => {
    it('returns healthy status without auth', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.uptime).toBeDefined();
      expect(res.body.institutions).toBeDefined();
      expect(res.body.transactions).toBeDefined();
      expect(res.body.plaid_env).toBe('sandbox');
    });
  });

  describe('Authentication', () => {
    it('rejects API routes without auth', async () => {
      const res = await request(app).get('/api/accounts');
      expect(res.status).toBe(401);
    });

    it('rejects API routes with wrong token', async () => {
      const res = await request(app)
        .get('/api/accounts')
        .set('Authorization', 'Bearer wrong');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/accounts', () => {
    it('returns account list', async () => {
      const res = await request(app)
        .get('/api/accounts')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.accounts).toBeInstanceOf(Array);
      expect(res.body.accounts.length).toBe(2);
    });

    it('filters by type', async () => {
      const res = await request(app)
        .get('/api/accounts?type=credit')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.accounts.length).toBe(1);
      expect(res.body.accounts[0].type).toBe('credit');
    });
  });

  describe('GET /api/accounts/institutions', () => {
    it('returns linked institutions', async () => {
      const res = await request(app)
        .get('/api/accounts/institutions')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.institutions).toBeInstanceOf(Array);
      expect(res.body.institutions.length).toBe(1);
      expect(res.body.institutions[0].name).toBe('Test Bank');
      expect(res.body.institutions[0].account_count).toBe(2);
    });
  });

  describe('GET /api/accounts/balances', () => {
    it('returns balances with totals and net worth', async () => {
      const res = await request(app)
        .get('/api/accounts/balances')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.accounts).toBeInstanceOf(Array);
      expect(res.body.totals).toBeDefined();
      expect(res.body.net_worth).toBeDefined();
      // net_worth = 5000 (checking) - 1200 (credit) = 3800
      expect(res.body.net_worth).toBe(3800);
    });
  });

  describe('GET /api/transactions', () => {
    it('returns transactions with pagination', async () => {
      const res = await request(app)
        .get('/api/transactions?scope=all')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.transactions).toBeInstanceOf(Array);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.limit).toBe(100);
      expect(res.body.offset).toBe(0);
    });

    it('filters by scope=personal', async () => {
      const res = await request(app)
        .get('/api/transactions?scope=personal')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      for (const txn of res.body.transactions) {
        expect(txn.is_business).toBe(false);
      }
    });

    it('filters by merchant name', async () => {
      const res = await request(app)
        .get('/api/transactions?merchant=Starbucks&scope=all')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.transactions.length).toBe(1);
      expect(res.body.transactions[0].merchant).toBe('Starbucks');
    });

    it('supports search parameter', async () => {
      const res = await request(app)
        .get('/api/transactions?search=Grocery&scope=all')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('supports min_amount filter', async () => {
      const res = await request(app)
        .get('/api/transactions?min_amount=100&scope=all')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      for (const txn of res.body.transactions) {
        expect(txn.amount).toBeGreaterThanOrEqual(100);
      }
    });
  });

  describe('GET /api/transactions/summary', () => {
    it('returns spending summary for current month', async () => {
      const res = await request(app)
        .get('/api/transactions/summary')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.period).toBeDefined();
      expect(res.body.totals).toBeDefined();
      expect(res.body.categories).toBeInstanceOf(Array);
    });

    it('supports period comparison', async () => {
      const res = await request(app)
        .get('/api/transactions/summary?compare=previous')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.comparison).toBeDefined();
      expect(res.body.comparison.period).toBeDefined();
      expect(res.body.comparison.totals).toBeDefined();
    });
  });

  describe('POST /api/transactions/:id/tag', () => {
    it('tags a transaction as business', async () => {
      const res = await request(app)
        .post('/api/transactions/txn_001/tag')
        .set('Authorization', AUTH_HEADER)
        .send({ is_business: true, custom_category: 'Business Meals' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transaction.is_business).toBe(1);
      expect(res.body.transaction.custom_category).toBe('Business Meals');
    });

    it('returns 404 for nonexistent transaction', async () => {
      const res = await request(app)
        .post('/api/transactions/txn_nonexistent/tag')
        .set('Authorization', AUTH_HEADER)
        .send({ is_business: true });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/transactions/sync', () => {
    it('triggers sync for all institutions', async () => {
      const res = await request(app)
        .post('/api/transactions/sync')
        .set('Authorization', AUTH_HEADER)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toBeDefined();
    });
  });

  describe('Budgets CRUD', () => {
    it('lists budgets', async () => {
      const res = await request(app)
        .get('/api/budgets')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.budgets).toBeInstanceOf(Array);
      expect(res.body.budgets.length).toBe(2);
    });

    it('creates a budget', async () => {
      const res = await request(app)
        .post('/api/budgets')
        .set('Authorization', AUTH_HEADER)
        .send({ category: 'TRANSPORTATION', amount: 300 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.budget.category).toBe('TRANSPORTATION');
    });

    it('rejects budget without category', async () => {
      const res = await request(app)
        .post('/api/budgets')
        .set('Authorization', AUTH_HEADER)
        .send({ amount: 300 });

      expect(res.status).toBe(400);
    });

    it('rejects budget with zero amount', async () => {
      const res = await request(app)
        .post('/api/budgets')
        .set('Authorization', AUTH_HEADER)
        .send({ category: 'TEST', amount: 0 });

      expect(res.status).toBe(400);
    });

    it('updates a budget', async () => {
      const res = await request(app)
        .put('/api/budgets/1')
        .set('Authorization', AUTH_HEADER)
        .send({ amount: 750 });

      expect(res.status).toBe(200);
      expect(res.body.budget.amount).toBe(750);
    });

    it('deletes a budget', async () => {
      const res = await request(app)
        .delete('/api/budgets/2')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Category Overrides', () => {
    it('lists overrides', async () => {
      const res = await request(app)
        .get('/api/categories/overrides')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.overrides).toBeInstanceOf(Array);
      expect(res.body.overrides.length).toBe(2);
    });

    it('creates a new override', async () => {
      const res = await request(app)
        .post('/api/categories/overrides')
        .set('Authorization', AUTH_HEADER)
        .send({
          merchant_pattern: 'Target',
          custom_category: 'Shopping',
          scope: 'personal',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects override without required fields', async () => {
      const res = await request(app)
        .post('/api/categories/overrides')
        .set('Authorization', AUTH_HEADER)
        .send({ merchant_pattern: 'Test' });

      expect(res.status).toBe(400);
    });

    it('deletes an override', async () => {
      const res = await request(app)
        .delete('/api/categories/overrides/1')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
