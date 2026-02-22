import 'dotenv/config';
import type { AppConfig, PlaidEnv } from './types';

const required = ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'ENCRYPTION_KEY', 'BEARER_TOKEN'] as const;
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Run "npm run generate-keys" to generate ENCRYPTION_KEY and BEARER_TOKEN');
  process.exit(1);
}

const PLAID_ENV_MAP: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

const plaidEnv = (process.env['PLAID_ENV'] || 'sandbox') as string;
if (!(plaidEnv in PLAID_ENV_MAP)) {
  console.error(`Invalid PLAID_ENV: ${plaidEnv}. Must be sandbox, development, or production.`);
  process.exit(1);
}

const validPlaidEnv = plaidEnv as PlaidEnv;

const config: AppConfig = {
  port: parseInt(process.env['PORT'] ?? '3100', 10),
  host: process.env['HOST'] ?? '127.0.0.1',
  logLevel: process.env['LOG_LEVEL'] ?? 'info',

  plaid: {
    clientId: process.env['PLAID_CLIENT_ID']!,
    secret: process.env['PLAID_SECRET']!,
    env: validPlaidEnv,
    baseUrl: PLAID_ENV_MAP[validPlaidEnv],
  },

  encryption: {
    key: Buffer.from(process.env['ENCRYPTION_KEY']!, 'hex'),
  },

  bearerToken: process.env['BEARER_TOKEN']!,
  webhookUrl: process.env['WEBHOOK_URL'] ?? null,
  openclawWebhookUrl: process.env['OPENCLAW_WEBHOOK_URL'] ?? null,
};

export default config;
