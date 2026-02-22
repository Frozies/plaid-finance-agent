import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Import after setup.ts sets env vars
import authMiddleware from '../middleware/auth';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/accounts',
    method: 'GET',
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('auth middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('passes through for /health path', () => {
    const req = mockReq({ path: '/health' });
    const res = mockRes();

    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes through for /public/ paths', () => {
    const req = mockReq({ path: '/public/link.html' });
    const res = mockRes();

    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects request without authorization header', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();

    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toContain('Missing');
  });

  it('rejects request with non-Bearer auth header', () => {
    const req = mockReq({ headers: { authorization: 'Basic abc123' } });
    const res = mockRes();

    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects request with wrong bearer token', () => {
    const req = mockReq({ headers: { authorization: 'Bearer wrong_token' } });
    const res = mockRes();

    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { error: string }).error).toContain('Invalid');
  });

  it('allows request with correct bearer token', () => {
    const token = process.env['BEARER_TOKEN']!;
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();

    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
