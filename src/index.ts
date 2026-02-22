import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';

import config from './config';
import logger from './services/logger';
import authMiddleware from './middleware/auth';
import errorHandler from './middleware/errors';
import { getDb, closeDb } from './db/connection';
import { startScheduler } from './services/scheduler';

import linkRoutes from './routes/link';
import accountRoutes from './routes/accounts';
import transactionRoutes from './routes/transactions';
import investmentRoutes from './routes/investments';
import liabilityRoutes from './routes/liabilities';
import budgetRoutes from './routes/budgets';
import webhookRoutes from './routes/webhooks';

import type { CountResult } from './types';

const app = express();

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.plaid.com"],
      connectSrc: ["'self'", "https://*.plaid.com"],
      frameSrc: ["'self'", "https://*.plaid.com"],
    },
  },
}));

app.use(cors({ origin: false }));
app.use(express.json());

// Static files (Plaid Link page)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Health check (no auth)
app.get('/health', (_req, res) => {
  const db = getDb();
  try {
    db.prepare('SELECT 1').get();
    const instCount = (db.prepare('SELECT COUNT(*) as count FROM institutions').get() as CountResult).count;
    const txnCount = (db.prepare('SELECT COUNT(*) as count FROM transactions').get() as CountResult).count;
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      institutions: instCount,
      transactions: txnCount,
      plaid_env: config.plaid.env,
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: (err as Error).message });
  }
});

// Webhooks (Plaid sends these — different auth model)
app.use('/api/webhooks', webhookRoutes);

// Auth middleware for all other API routes
app.use('/api', authMiddleware);

// API routes
app.use('/api/link', linkRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/balances', accountRoutes);
app.use('/api/institutions', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', transactionRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/liabilities', liabilityRoutes);
app.use('/api/budgets', budgetRoutes);

// Error handler
app.use(errorHandler);

// Start server
const server = app.listen(config.port, config.host, () => {
  logger.info(`Finance Agent backend running on ${config.host}:${config.port}`);
  logger.info(`Plaid environment: ${config.plaid.env}`);
  logger.info(`Webhooks: ${config.webhookUrl ? 'enabled' : 'disabled (poll-only mode)'}`);

  getDb();
  startScheduler();
});

// Graceful shutdown
function shutdown(signal: string): void {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    closeDb();
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
