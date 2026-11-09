import { fileDownload } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { type QueryCacheNotifyEvent, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export type OpenOperation = {
  scope: object;
  kind: 'read' | 'write';
  readEpoch: number;
  writeEpoch: number;
};
export type OpenAccess = {
  begin: (kind?: 'read' | 'write') => OpenOperation;
  active: (operation: OpenOperation) => boolean;
};
export type OpenLife = {
  alive: boolean;
  access: OpenAccess;
  query: object | undefined;
};
const OPEN_ERROR = {
  code: 'EMPLOYEE_DOCUMENT_OPEN_FAILED',
  message_ar: t('ar', 'employeeDocuments.openRetry'),
  message_en: t('en', 'employeeDocuments.openRetry'),
};
type Attempt = {
  token: object;
  operation: OpenOperation;
  storageKey: string;
  handle: Window;
  owned: boolean;
  query: object | undefined;
  life: OpenLife;
};
export type OpenContext = {
  client: QueryClient;
  key: readonly string[];
  header: { 'x-company-id': string };
  life: OpenLife;
  registry: Map<object, Attempt>;
  pending: Attempt | null;
  opening: Attempt | null;
  generation: number;
  show: (error?: typeof OPEN_ERROR, opening?: boolean) => void;
  schedule: (notify: () => void) => void;
};

function sameKey(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function listed(client: QueryClient, key: readonly string[], storageKey: string) {
  const data = client.getQueryData<{ items: { object_key: string }[] }>(key);
  return data?.items.some((item) => item.object_key === storageKey) === true;
}
function installed(client: QueryClient, key: readonly string[]) {
  return client.getQueryCache().find({ queryKey: key, exact: true });
}
function closeNative(handle: Window) {
  try {
    handle.close();
  } catch {
    // إغلاق placeholder محاولة أخيرة؛ تفاصيل المتصفح لا تدخل العرض أو الكاش.
  }
}
function acquireBlank(): Window {
  const handle = window.open('about:blank', '_blank');
  if (!handle) throw OPEN_ERROR;
  try {
    handle.opener = null;
    if (handle.opener !== null || handle.closed) throw OPEN_ERROR;
  } catch (error) {
    closeNative(handle);
    throw error === OPEN_ERROR ? error : OPEN_ERROR;
  }
  return handle;
}
function witnessed(life: OpenLife, client: QueryClient, key: readonly string[]) {
  const current = installed(client, key);
  return life.alive && life.query !== undefined && life.query === current;
}
function authorized(attempt: Attempt, ctx: OpenContext) {
  return (
    witnessed(attempt.life, ctx.client, ctx.key) &&
    attempt.owned &&
    !attempt.handle.closed &&
    attempt.life.access.active(attempt.operation) &&
    listed(ctx.client, ctx.key, attempt.storageKey) &&
    attempt.query === installed(ctx.client, ctx.key)
  );
}
function detach(ctx: OpenContext, attempt: Attempt) {
  ctx.registry.delete(attempt.token);
  const owned = attempt.owned;
  attempt.owned = false;
  if (ctx.pending === attempt) ctx.pending = null;
  if (ctx.opening === attempt) ctx.opening = null;
  if (owned && !attempt.handle.closed) closeNative(attempt.handle);
}
function revoke(ctx: OpenContext, attempt: Attempt, failed: boolean, immediate: boolean) {
  const owns = ctx.opening === attempt;
  const life = ctx.life;
  const generation = ctx.generation;
  detach(ctx, attempt);
  if (!owns) return;
  const paint = () => {
    if (ctx.generation !== generation || ctx.life !== life) return;
    ctx.show(failed ? OPEN_ERROR : undefined, false);
  };
  if (immediate) paint();
  else ctx.schedule(paint);
}
function noteRead(event: QueryCacheNotifyEvent, ctx: OpenContext) {
  if (!ctx.life.alive || !sameKey(event.query.queryKey, ctx.key)) return;
  if (event.type === 'removed') {
    if (event.query === ctx.life.query) ctx.life.query = undefined;
    return;
  }
  if (event.type !== 'updated') return;
  const action = event.action;
  if (!action || action.type !== 'success' || action.manual === true) return;
  if (event.query !== installed(ctx.client, ctx.key)) return;
  if (event.query.state.status !== 'success') return;
  ctx.life.query = event.query;
}
export function watchOpen(ctx: OpenContext) {
  const reconcile = () => {
    const attempt = ctx.pending;
    if (attempt?.owned && attempt.handle.closed) revoke(ctx, attempt, true, true);
  };
  const unsubscribe = ctx.client.getQueryCache().subscribe((event) => {
    noteRead(event, ctx);
    const attempt = ctx.pending;
    if (attempt && !authorized(attempt, ctx)) revoke(ctx, attempt, true, false);
  });
  window.addEventListener('focus', reconcile);
  document.addEventListener('visibilitychange', reconcile);
  return () => {
    window.removeEventListener('focus', reconcile);
    document.removeEventListener('visibilitychange', reconcile);
    unsubscribe();
    ctx.generation += 1;
    const attempt = ctx.pending;
    if (attempt) detach(ctx, attempt);
  };
}
export function beginOpen(
  storageKey: string,
  ctx: OpenContext,
  life: OpenLife,
  submit: (token: object) => void,
) {
  if (!witnessed(life, ctx.client, ctx.key)) return;
  const previous = ctx.pending;
  if (previous?.owned && !previous.handle.closed) return;
  if (previous) revoke(ctx, previous, false, true);
  const operation = life.access.begin();
  if (!life.access.active(operation) || !listed(ctx.client, ctx.key, storageKey)) return;
  let handle: Window;
  try {
    handle = acquireBlank();
  } catch {
    ctx.generation += 1;
    ctx.show(OPEN_ERROR, false);
    return;
  }
  const token = {};
  const attempt: Attempt = {
    token,
    operation,
    storageKey,
    handle,
    owned: true,
    query: installed(ctx.client, ctx.key),
    life,
  };
  ctx.registry.set(token, attempt);
  ctx.pending = attempt;
  ctx.opening = attempt;
  ctx.generation += 1;
  ctx.show(undefined, true);
  try {
    submit(token);
  } catch {
    revoke(ctx, attempt, true, true);
  }
}
export function releaseUnconsumed(token: object, ctx: OpenContext) {
  const attempt = ctx.registry.get(token);
  if (attempt) revoke(ctx, attempt, true, true);
}
export async function settle(token: object, ctx: OpenContext) {
  const attempt = ctx.registry.get(token);
  ctx.registry.delete(token);
  if (!attempt) throw OPEN_ERROR;
  try {
    if (!authorized(attempt, ctx)) throw OPEN_ERROR;
    const result = await apiClient().POST('/v1/files/download', {
      params: { header: ctx.header },
      body: { storage_key: attempt.storageKey },
    });
    if (result.error || !authorized(attempt, ctx)) throw OPEN_ERROR;
    const download = fileDownload.parse(result.data);
    if (!authorized(attempt, ctx)) throw OPEN_ERROR;
    attempt.handle.location.assign(download.download_url);
    attempt.owned = false;
    if (ctx.pending === attempt) ctx.pending = null;
    if (ctx.opening === attempt) {
      ctx.opening = null;
      ctx.show(undefined, false);
    }
  } catch {
    if (attempt.owned && !attempt.handle.closed) closeNative(attempt.handle);
    attempt.owned = false;
    if (ctx.pending === attempt) ctx.pending = null;
    if (ctx.opening === attempt) {
      ctx.opening = null;
      ctx.show(OPEN_ERROR, false);
    }
    throw OPEN_ERROR;
  }
}
