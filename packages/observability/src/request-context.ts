import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who and what one request is about, for its log lines (CLAUDE.md §8). The request id is known when the request
 * arrives; the company and user only after the guards verified them, so they are filled in later.
 */
export interface RequestContext {
  readonly requestId: string;
  companyId?: string;
  branchId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Starts the context for the rest of the current async execution — called once per request, first thing.
 *
 * @param requestId the request's id
 */
export function enterRequestContext(requestId: string): void {
  storage.enterWith({ requestId });
}

/**
 * Adds what the guards verified to the current request's context. Outside a request it does nothing.
 *
 * @param fields the verified company, branch or user
 */
export function updateRequestContext(fields: Partial<Omit<RequestContext, 'requestId'>>): void {
  const current = storage.getStore();
  if (current === undefined) return;
  for (const [key, value] of Object.entries(fields) as [
    keyof typeof fields,
    string | undefined,
  ][]) {
    if (value !== undefined) current[key] = value;
  }
}

/**
 * The context as log fields — snake_case, present only when known. pino adds these to every line.
 *
 * @returns request_id, and company_id / branch_id / user_id when verified
 */
export function requestContextFields(): Record<string, string> {
  const current = storage.getStore();
  if (current === undefined) return {};
  return {
    request_id: current.requestId,
    ...(current.companyId === undefined ? {} : { company_id: current.companyId }),
    ...(current.branchId === undefined ? {} : { branch_id: current.branchId }),
    ...(current.userId === undefined ? {} : { user_id: current.userId }),
  };
}
