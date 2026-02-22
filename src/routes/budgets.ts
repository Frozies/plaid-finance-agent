import { Router, type Request, type Response } from 'express';
import * as budgetService from '../services/budget';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const statuses = budgetService.getAllBudgetStatus();
  res.json({ budgets: statuses });
});

interface CreateBudgetBody {
  category?: string;
  amount?: number | string;
  period?: string;
  scope?: string;
}

router.post('/', (req: Request<unknown, unknown, CreateBudgetBody>, res: Response) => {
  const { category, amount, period, scope } = req.body;

  if (!category || !amount) {
    res.status(400).json({ error: 'category and amount are required' });
    return;
  }

  const parsedAmount = parseFloat(String(amount));
  if (parsedAmount <= 0) {
    res.status(400).json({ error: 'amount must be positive' });
    return;
  }

  const budget = budgetService.createBudget({
    category,
    amount: parsedAmount,
    period: (period as 'weekly' | 'monthly' | 'yearly') ?? 'monthly',
    scope: (scope as 'personal' | 'business' | 'all') ?? 'personal',
  });

  res.status(201).json({ success: true, budget });
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  const budget = budgetService.updateBudget(parseInt(req.params.id, 10), req.body as Record<string, unknown>);
  if (!budget) {
    res.status(404).json({ error: 'Budget not found or nothing to update' });
    return;
  }
  res.json({ success: true, budget });
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  budgetService.deleteBudget(parseInt(req.params.id, 10));
  res.json({ success: true });
});

interface AlertsQuery {
  threshold?: string;
}

router.get('/alerts', (req: Request<unknown, unknown, unknown, AlertsQuery>, res: Response) => {
  const { threshold = '80' } = req.query;
  const violations = budgetService.checkBudgetAlerts(parseInt(threshold, 10));
  res.json({ alerts: violations });
});

export default router;
