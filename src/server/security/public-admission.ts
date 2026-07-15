import type { Request } from "express";

interface BudgetEntry {
  count: number;
  resetAt: number;
}

const budgets = new Map<string, BudgetEntry>();
const MAX_BUDGET_KEYS = 5_000;

export function consumePublicBudget(request: Request, scope: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const key = `${scope}:${request.ip || request.socket?.remoteAddress || "unknown"}`;
  const current = budgets.get(key);
  if (!current || current.resetAt <= now) {
    budgets.delete(key);
    budgets.set(key, { count: 1, resetAt: now + windowMs });
    trimBudgets(now);
    return true;
  }
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  budgets.delete(key);
  budgets.set(key, current);
  return true;
}

function trimBudgets(now: number): void {
  for (const [key, entry] of budgets) {
    if (entry.resetAt <= now) {
      budgets.delete(key);
    }
  }
  while (budgets.size > MAX_BUDGET_KEYS) {
    const oldest = budgets.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    budgets.delete(oldest);
  }
}
