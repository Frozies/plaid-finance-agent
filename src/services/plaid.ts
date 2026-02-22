import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type LinkTokenCreateRequest,
  type TransactionsSyncResponse,
  type ItemGetResponse,
  type AccountsGetResponse,
  type InvestmentsHoldingsGetResponse,
  type LiabilitiesGetResponse,
  type TransactionsRecurringGetResponse,
  type Institution,
  type LinkTokenCreateResponse,
  type ItemPublicTokenExchangeResponse,
} from 'plaid';
import config from '../config';
import { decrypt } from './crypto';
import { getDb } from '../db/connection';
import logger from './logger';
import type { InstitutionRow } from '../types';

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[config.plaid.env],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': config.plaid.clientId,
      'PLAID-SECRET': config.plaid.secret,
    },
  },
});

export const client = new PlaidApi(plaidConfig);

interface CreateLinkTokenOptions {
  userId?: string;
  products?: Products[];
  updateMode?: { accessToken: string } | null;
}

export async function createLinkToken({
  userId = 'default-user',
  products = undefined,
  updateMode = null,
}: CreateLinkTokenOptions = {}): Promise<LinkTokenCreateResponse> {
  const request: LinkTokenCreateRequest = {
    user: { client_user_id: userId },
    client_name: 'Finance Agent',
    products: products ?? [Products.Transactions, Products.Investments, Products.Liabilities],
    country_codes: [CountryCode.Us],
    language: 'en',
  };

  if (config.webhookUrl) {
    request.webhook = config.webhookUrl;
  }

  if (updateMode) {
    request.access_token = updateMode.accessToken;
    delete request.products;
  }

  const response = await client.linkTokenCreate(request);
  return response.data;
}

export async function exchangePublicToken(publicToken: string): Promise<ItemPublicTokenExchangeResponse> {
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return response.data;
}

export function getAccessToken(institutionId: string): string {
  const db = getDb();
  const inst = db.prepare(
    'SELECT encrypted_access_token, iv, auth_tag FROM institutions WHERE id = ?'
  ).get(institutionId) as Pick<InstitutionRow, 'encrypted_access_token' | 'iv' | 'auth_tag'> | undefined;
  if (!inst) throw new Error(`Institution not found: ${institutionId}`);
  return decrypt(inst.encrypted_access_token, inst.iv, inst.auth_tag);
}

export async function getItem(accessToken: string): Promise<ItemGetResponse> {
  const response = await client.itemGet({ access_token: accessToken });
  return response.data;
}

export async function getAccounts(accessToken: string): Promise<AccountsGetResponse> {
  const response = await client.accountsGet({ access_token: accessToken });
  return response.data;
}

export async function getBalances(accessToken: string, accountIds: string[] | null = null): Promise<AccountsGetResponse> {
  const request: { access_token: string; options?: { account_ids: string[] } } = {
    access_token: accessToken,
  };
  if (accountIds) {
    request.options = { account_ids: accountIds };
  }
  const response = await client.accountsBalanceGet(request);
  return response.data;
}

export interface TransactionSyncResult {
  added: TransactionsSyncResponse['added'];
  modified: TransactionsSyncResponse['modified'];
  removed: TransactionsSyncResponse['removed'];
  cursor: string;
}

export async function syncTransactions(accessToken: string, cursor: string | null = null): Promise<TransactionSyncResult> {
  const added: TransactionsSyncResponse['added'] = [];
  const modified: TransactionsSyncResponse['modified'] = [];
  const removed: TransactionsSyncResponse['removed'] = [];
  let hasMore = true;
  let nextCursor = cursor;

  while (hasMore) {
    const request: { access_token: string; cursor?: string; options: { include_personal_finance_category: boolean } } = {
      access_token: accessToken,
      options: { include_personal_finance_category: true },
    };
    if (nextCursor) {
      request.cursor = nextCursor;
    }

    const response = await client.transactionsSync(request);
    const data = response.data;

    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;
  }

  return { added, modified, removed, cursor: nextCursor! };
}

export async function getInvestments(accessToken: string): Promise<InvestmentsHoldingsGetResponse> {
  const response = await client.investmentsHoldingsGet({
    access_token: accessToken,
  });
  return response.data;
}

export async function getLiabilities(accessToken: string): Promise<LiabilitiesGetResponse> {
  const response = await client.liabilitiesGet({
    access_token: accessToken,
  });
  return response.data;
}

export async function getRecurringTransactions(accessToken: string, accountIds: string[]): Promise<TransactionsRecurringGetResponse> {
  const response = await client.transactionsRecurringGet({
    access_token: accessToken,
    account_ids: accountIds,
  });
  return response.data;
}

export async function getInstitutionInfo(institutionId: string): Promise<Institution | null> {
  try {
    const response = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    return response.data.institution;
  } catch (err) {
    logger.warn(`Could not fetch institution info for ${institutionId}: ${(err as Error).message}`);
    return null;
  }
}

interface PlaidErrorResponse {
  response?: {
    data?: {
      error_code?: string;
    };
  };
}

export function isReauthRequired(error: unknown): boolean {
  return (error as PlaidErrorResponse)?.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED';
}
