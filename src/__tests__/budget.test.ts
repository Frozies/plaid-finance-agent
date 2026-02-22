import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from './helpers/testdb';

// Mock the database connection module to use our test database
let testDb: Database.Database;

vi.mock('../db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => testDb?.close(),
}));

// Import after mocking
import { getPeriodStart, getBudgetSpending, createBudget, updateBudget, deleteBudget, getAllBudgetStatus } from '../services/budget';
import type { BudgetRow } from '../types';

describe('budget service', () => {
  beforeEach(() => {
    testDb = createTestDb();
    seedTestData(testDb);
  });

  afterEach(() => {
    testDb?.close();
  });

  describe('getPeriodStart', () => {
    it('returns start of current month for monthly period', () => {
      // Use local-time constructor to avoid UTC timezone offset issues
      const ref = new Date(2026, 1, 15); // Feb 15, 2026
      expect(getPeriodStart('monthly', ref)).toBe('2026-02-01');
    });

    it('returns start of current week (Sunday) for weekly period', () => {
      // 2026-02-18 is a Wednesday (local time)
      const ref = new Date(2026, 1, 18);
      const result = getPeriodStart('weekly', ref);
      // Should go back to Sunday — Feb 15, 2026
      expect(result).toBe('2026-02-15');
    });

    it('returns start of year for yearly period', () => {
      const ref = new Date(2026, 5, 15); // Jun 15, 2026
      expect(getPeriodStart('yearly', ref)).toBe('2026-01-01');
    });

    it('returns current date as default for unknown period', () => {
      const ref = new Date(2026, 2, 10); // Mar 10, 2026
      const result = getPeriodStart('unknown', ref);
      // Should return the date unchanged (no case matched)
      expect(result).toBe('2026-03-10');
    });
  });

  describe('createBudget', () => {
    it('creates a budget with defaults', () => {
      const budget = createBudget({ category: 'TRANSPORTATION', amount: 300 });
      expect(budget.id).toBeGreaterThan(0);
      expect(budget.category).toBe('TRANSPORTATION');
      expect(budget.amount).toBe(300);
      expect(budget.period).toBe('monthly');
      expect(budget.scope).toBe('personal');
    });

    it('creates a budget with custom period and scope', () => {
      const budget = createBudget({
        category: 'RENT',
        amount: 1500,
        period: 'monthly',
        scope: 'all',
      });
      expect(budget.amount).toBe(1500);
      expect(budget.scope).toBe('all');
    });
  });

  describe('updateBudget', () => {
    it('updates budget amount', () => {
      const result = updateBudget(1, { amount: 600 });
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(600);
    });

    it('updates multiple fields', () => {
      const result = updateBudget(1, { amount: 700, scope: 'all' });
      expect(result!.amount).toBe(700);
      expect(result!.scope).toBe('all');
    });

    it('ignores invalid fields', () => {
      const result = updateBudget(1, { invalid_field: 'hack' });
      expect(result).toBeNull(); // No valid fields → returns null
    });

    it('returns null for nonexistent budget', () => {
      const result = updateBudget(999, { amount: 100 });
      // The update runs but no row matched, still returns the SELECT result
      expect(result).toBeNull();
    });
  });

  describe('deleteBudget', () => {
    it('deletes a budget', () => {
      const result = deleteBudget(1);
      expect(result.changes).toBe(1);

      // Verify it's gone
      const row = testDb.prepare('SELECT * FROM budgets WHERE id = 1').get();
      expect(row).toBeUndefined();
    });

    it('returns 0 changes for nonexistent budget', () => {
      const result = deleteBudget(999);
      expect(result.changes).toBe(0);
    });
  });

  describe('getBudgetSpending', () => {
    it('calculates spending for a budget', () => {
      const budget = testDb.prepare('SELECT * FROM budgets WHERE id = 1').get() as BudgetRow;
      const status = getBudgetSpending(budget);

      expect(status.category).toBe('FOOD_AND_DRINK');
      expect(status.amount).toBe(500);
      expect(status.spent).toBeGreaterThanOrEqual(0);
      expect(status.remaining).toBeDefined();
      expect(status.percent).toBeDefined();
      expect(status.period_start).toBeTruthy();
    });
  });

  describe('getAllBudgetStatus', () => {
    it('returns status for all active budgets', () => {
      const statuses = getAllBudgetStatus();
      expect(statuses.length).toBe(2); // We seeded 2 budgets
      for (const s of statuses) {
        expect(s.spent).toBeDefined();
        expect(s.remaining).toBeDefined();
      }
    });
  });
});
