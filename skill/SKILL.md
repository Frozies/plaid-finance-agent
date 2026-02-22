# Plaid Finance Agent

Personal and business finance management. Query balances, transactions, budgets, investments, and liabilities conversationally.

## Configuration

- `FINANCE_API_URL`: Backend URL (default: `http://localhost:3100`)
- `FINANCE_API_TOKEN`: Bearer token for authentication

## Commands

### 💰 Balances
| Trigger | Action |
|---------|--------|
| "What's my balance?" / "How much is in checking?" | GET /api/balances |
| "Show all balances" / "What's my net worth?" | GET /api/balances (includes net_worth) |
| "Refresh balances" | GET /api/balances?refresh=true |

### 📊 Transactions
| Trigger | Action |
|---------|--------|
| "What did I spend on [category] this [period]?" | GET /api/transactions?category=X&start=Y&end=Z |
| "Show my Amazon purchases" | GET /api/transactions?merchant=Amazon |
| "Business expenses this month" | GET /api/transactions?scope=business&start=MONTH_START |
| "What did I spend today?" | GET /api/transactions?start=TODAY&end=TODAY |
| "Spending summary" / "Compare this month to last" | GET /api/transactions/summary?compare=previous |

**Default scope is personal.** Only include `scope=business` when the user explicitly mentions business, Sunset Vista, or client expenses.

**Time parsing:**
- "today" → start=TODAY, end=TODAY
- "this week" → start=SUNDAY, end=TODAY
- "this month" → start=MONTH_1ST, end=TODAY
- "last month" → period=last_month
- "in January" → start=2026-01-01, end=2026-01-31

### 💳 Budgets
| Trigger | Action |
|---------|--------|
| "How am I doing on budgets?" | GET /api/budgets |
| "Set a $500 dining budget" | POST /api/budgets `{"category":"FOOD_AND_DRINK","amount":500}` |
| "Set a $200/month business software budget" | POST /api/budgets `{"category":"Software","amount":200,"scope":"business"}` |
| "Delete the dining budget" | DELETE /api/budgets/:id |
| "Budget alerts" | GET /api/budgets/alerts |

### 📈 Investments
| Trigger | Action |
|---------|--------|
| "How's my portfolio?" / "Investment summary" | GET /api/investments |
| "Portfolio performance this month" | GET /api/investments/performance?days=30 |
| "What are my holdings?" | GET /api/investments (show holdings list) |

### 💸 Liabilities
| Trigger | Action |
|---------|--------|
| "What do I owe?" / "Show debts" | GET /api/liabilities |
| "Credit card balances" | GET /api/liabilities (show credit section) |

### 🏦 Account Management
| Trigger | Action |
|---------|--------|
| "Link a bank account" | POST /api/link/token → send link URL to user |
| "Show linked accounts" | GET /api/accounts |
| "Which accounts need attention?" | GET /api/accounts/institutions (filter status != active) |
| "Unlink Chase" | DELETE /api/institutions/:id |

### 🏷️ Categorization & Tagging
| Trigger | Action |
|---------|--------|
| "Mark Canva as business" | POST /api/categories/overrides `{"merchant_pattern":"Canva","scope":"business","custom_category":"Software"}` |
| "Tag this transaction as business" | POST /api/transactions/:id/tag `{"is_business":true}` |
| "Show category rules" | GET /api/categories/overrides |
| "Remove the Canva rule" | DELETE /api/categories/overrides/:id |

### 🔄 Sync
| Trigger | Action |
|---------|--------|
| "Sync transactions" / "Refresh data" | POST /api/transactions/sync |

## Response Formatting

Format responses for Telegram readability:

**Balances:**
```
💰 Balances
━━━━━━━━━━━━━━━━━━━━━━
Chase Checking     $4,231.50
Chase Savings     $12,800.00
Amex Platinum     -$1,245.67
━━━━━━━━━━━━━━━━━━━━━━
Net Worth:        $15,785.83
```

**Budget status** — use emoji indicators:
- 🟢 Under 60%
- 🟡 60-89%
- 🔴 90%+ or exceeded

**Transaction lists** — show date, merchant, amount, category. Limit to 10 items, mention total count if more exist.

**Investments** — show total value, day/month change, top 5 holdings by value.

## Error Handling

- If API returns 401/403: "I can't reach the finance backend. Check that it's running and the token is correct."
- If institution needs re-auth: Show the re-auth link and explain why.
- If no data: "No [transactions/accounts/etc] found for that query. Try a different date range or category."

## Security Notes

- Never display access tokens, encryption keys, or bearer tokens
- Don't log or repeat raw API responses that might contain sensitive account numbers
- Account masks (last 4 digits) are safe to display
