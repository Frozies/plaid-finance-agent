import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger';

interface PlaidApiError extends Error {
  response?: {
    data?: {
      error_code?: string;
      error_message?: string;
      display_message?: string;
    };
  };
  status?: number;
}

function errorHandler(err: PlaidApiError, req: Request, res: Response, _next: NextFunction): void {
  logger.error(`${req.method} ${req.path}: ${err.message}`, { stack: err.stack });

  if (err.response?.data?.error_code) {
    const plaidError = err.response.data;
    res.status(400).json({
      error: 'plaid_error',
      error_code: plaidError.error_code,
      error_message: plaidError.error_message,
      display_message: plaidError.display_message,
    });
    return;
  }

  if (err.status === 400) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}

export default errorHandler;
