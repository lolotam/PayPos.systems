import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export type KillableProcess = {
  kill(signal: NodeJS.Signals): boolean;
  readonly pid?: number;
  readonly children?: readonly KillableProcess[];
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  once?(event: 'exit', listener: () => void): unknown;
  off?(event: 'exit', listener: () => void): unknown;
};

const CLEANUP_KEY = Symbol('launchCleanup');
const RETRY_KEY = Symbol('launchCleanupRetry');
const UNCONFIRMED_DESCENDANT_KEY = Symbol('unconfirmedDescendantKill');
const PID_POLL_MS = 10;
const pollTick = (): Promise<void> => new Promise((r) => { setTimeout(r, PID_POLL_MS).unref(); });
export const LAUNCH_MARKER_ENV = 'POSPAY_CHROMIUM_LAUNCH_ID';

function markUnconfirmedDescendants(error: Error): Error {
  Object.defineProperty(error, UNCONFIRMED_DESCENDANT_KEY, { value: true, enumerable: false, configurable: true });
  return error;
}

/** يتحقق إن فشل القتل سببه بقاء تابع مكتشف حيّاً عشان إغلاق المتصفح الجذر ما يفتحش البوابة بالغلط. */
export function hasUnconfirmedDescendants(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as Record<symbol, unknown>)[UNCONFIRMED_DESCENDANT_KEY] === true;
}

function errorWithCleanup(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'DOCUMENT_LAUNCH_FAILED');
}

/** يربط وعد تنظيف Chromium المتروك ودالة إعادة المحاولة بخطأ الإطلاق عشان المُصيّر يقفل البوابة لحين انتهاء القتل. */
export function withLaunchCleanup(error: unknown, cleanup: Promise<void>, retryKill?: () => Promise<void> | void): Error {
  const wrapped = errorWithCleanup(error);
  const safeCleanup = cleanup.then(() => undefined, (err: unknown) => { throw err instanceof Error ? err : new Error('DOCUMENT_LAUNCH_CLEANUP_FAILED'); });
  safeCleanup.catch(() => undefined);
  Object.defineProperty(wrapped, CLEANUP_KEY, { value: safeCleanup, enumerable: false, configurable: true });
  if (retryKill !== undefined) Object.defineProperty(wrapped, RETRY_KEY, { value: retryKill, enumerable: false, configurable: true });
  return wrapped;
}

/** يقرأ وعد تنظيف Chromium المرتبط بخطأ إطلاق بعد تفرّع العملية إن وُجد. */
export function getLaunchCleanup(error: unknown): Promise<void> | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = (error as Record<symbol, unknown>)[CLEANUP_KEY];
  return value instanceof Promise ? (value as Promise<void>) : undefined;
}

/** يقرأ دالة إعادة قتل عملية الإطلاق الفاشل لو التنظيف الأول اترفض. */
export function getLaunchCleanupRetry(error: unknown): (() => Promise<void> | void) | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = (error as Record<symbol, unknown>)[RETRY_KEY];
  return typeof value === 'function' ? (value as () => Promise<void> | void) : undefined;
}

const confirmedExits = new WeakSet<KillableProcess>();

export function hasExited(proc: KillableProcess): boolean {
  return (proc.exitCode !== undefined && proc.exitCode !== null) || (proc.signalCode !== undefined && proc.signalCode !== null) || confirmedExits.has(proc);
}

/** يميز حالة الزومبي أو الخروج في `/proc/<pid>/stat` عشان التنظيف ما يعلّقش من غير reaper. */
export function isLinuxStatZombie(statText: string): boolean {
  const closeParen = statText.lastIndexOf(')');
  if (closeParen === -1) return false;
  const state = statText.slice(closeParen + 1).trimStart()[0];
  return state === 'Z' || state === 'X' || state === 'x';
}

function osPidExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException | null)?.code === 'EPERM'; }
}

/** يتحقق إن العملية لسه حيّة ومش زومبي، وما يعتبرش فشل القراءة خروجاً إلا لو فحص النواة أكد ESRCH. */
export function isPidAlive(pid: number, procRoot = '/proc'): boolean {
  if (!osPidExists(pid)) return false;
  if (process.platform === 'linux' || procRoot !== '/proc') {
    try { return !isLinuxStatZombie(readFileSync(`${procRoot}/${pid}/stat`, 'utf8')); } catch { return osPidExists(pid); }
  }
  if (process.platform === 'darwin') {
    try {
      const state = execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8', timeout: 1_000 }).trim();
      return state.length === 0 ? osPidExists(pid) : !state.startsWith('Z');
    } catch { return osPidExists(pid); }
  }
  return true;
}

/** يقرأ أرقام التوابع المباشرة لخيط العملية في procfs ويتجاهل الخيوط اللي خرجت أثناء المسح. */
export function directLinuxChildren(pid: number, procRoot = '/proc'): number[] {
  let tids: string[];
  try { tids = readdirSync(`${procRoot}/${pid}/task`); } catch { return []; }
  const found = new Set<number>();
  for (const tid of tids) {
    try {
      const text = readFileSync(`${procRoot}/${pid}/task/${tid}/children`, 'utf8').trim();
      for (const token of text.split(/\s+/)) {
        const child = Number(token);
        if (Number.isInteger(child) && child > 0) found.add(child);
      }
    } catch { /* الخيط خرج أثناء القراءة */ }
  }
  return [...found];
}

function readLinuxProcessPairs(procRoot = '/proc'): Array<{ pid: number; ppid: number; pgrp: number }> {
  let entries: string[];
  try { entries = readdirSync(procRoot); } catch { return []; }
  const rows: Array<{ pid: number; ppid: number; pgrp: number }> = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`${procRoot}/${entry}/stat`, 'utf8');
      if (isLinuxStatZombie(stat)) continue;
      const closeParen = stat.lastIndexOf(')');
      if (closeParen === -1) continue;
      const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
      const ppid = Number(fields[1]);
      const pgrp = Number(fields[2]);
      const pid = Number(entry);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid > 0) rows.push({ pid, ppid, pgrp: Number.isInteger(pgrp) && pgrp > 0 ? pgrp : 0 });
    } catch { /* العملية خرجت أثناء قراءة stat */ }
  }
  return rows;
}

function readProcessTablePairs(procRoot = '/proc'): Array<{ pid: number; ppid: number; pgrp: number }> {
  if (process.platform === 'linux' || procRoot !== '/proc') return readLinuxProcessPairs(procRoot);
  if (process.platform !== 'darwin') return [];
  try {
    return execFileSync('ps', ['-eo', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 1_000 })
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .map(([p, pp, pg]) => ({ pid: Number(p), ppid: Number(pp), pgrp: Number(pg) || 0 }))
      .filter((r) => Number.isInteger(r.pid) && r.pid > 0 && Number.isInteger(r.ppid) && r.ppid > 0);
  } catch { return []; }
}

const pendingLaunches = new Map<string, KillableProcess | null>();
const launchedMarkers = new WeakMap<KillableProcess, string>();
let spawnHookInstalled = false;

/** يسجل مقبض العملية الذي أطلقه Playwright تحت وسم الإطلاق المقابل. */
export function recordLaunchedProcess(env: Record<string, unknown> | undefined, proc: KillableProcess): void {
  const marker = typeof env?.[LAUNCH_MARKER_ENV] === 'string' ? env[LAUNCH_MARKER_ENV] : undefined;
  if (marker !== undefined && pendingLaunches.has(marker)) {
    pendingLaunches.set(marker, proc);
    launchedMarkers.set(proc, marker);
  }
}

function ensureSpawnHook(): void {
  if (spawnHookInstalled) return;
  spawnHookInstalled = true;
  const require = createRequire(import.meta.url);
  const cp = require('node:child_process') as { spawn: (...args: unknown[]) => KillableProcess };
  const originalSpawn = cp.spawn;
  cp.spawn = function patchedSpawn(this: unknown, ...args: unknown[]): KillableProcess {
    const proc = originalSpawn.apply(this, args);
    const opts = args.length >= 3 ? args[2] : Array.isArray(args[1]) ? undefined : args[1];
    const env = opts !== null && typeof opts === 'object' ? (opts as { env?: Record<string, unknown> }).env : undefined;
    recordLaunchedProcess(env, proc);
    return proc;
  };
}

/** يبدأ تتبّع مقبض العملية الفعلي للإطلاق الحالي قبل استدعاء Playwright. */
export function beginLaunchProcessCapture(launchMarker: string): void {
  ensureSpawnHook();
  pendingLaunches.set(launchMarker, null);
}

/** يسحب مقبض العملية الفعلي الذي أنشأه Playwright لهذا الإطلاق ويمسح التتبّع. */
export function takeLaunchedProcess(launchMarker: string): KillableProcess | null {
  const proc = pendingLaunches.get(launchMarker) ?? null;
  pendingLaunches.delete(launchMarker);
  return proc;
}

/** ينشئ مقبض عملية موحّد مرتبط بوسم الإطلاق يفوّض لمقبض العملية الفعلي متى توفّر دون فقدان التوابع المحتجزة. */
export function createMarkerProcess(launchMarker: string, resolveTarget?: () => KillableProcess | null): KillableProcess {
  let bound: KillableProcess | null = null;
  const target = (): KillableProcess | null => (bound ??= resolveTarget?.() ?? null);
  const proc = Object.defineProperties({
    kill: (sig: NodeJS.Signals) => { const t = target(); return t === null ? true : t.kill(sig); },
  }, {
    pid: { get: () => target()?.pid, enumerable: true },
    children: { get: () => target()?.children, enumerable: true },
    exitCode: { get: () => { const t = target(); return t === null ? 0 : t.exitCode; }, enumerable: true },
    signalCode: { get: () => target()?.signalCode, enumerable: true },
    once: { get: () => { const t = target(); return typeof t?.once === 'function' ? t.once.bind(t) : undefined; }, enumerable: true },
    off: { get: () => { const t = target(); return typeof t?.off === 'function' ? t.off.bind(t) : undefined; }, enumerable: true },
  }) as KillableProcess;
  launchedMarkers.set(proc, launchMarker);
  return proc;
}

function collectDescendantPids(rootPids: readonly number[], procRoot = '/proc', groupHints: readonly number[] = []): { parentOf: Map<number, number>; groupOf: Map<number, number> } {
  const [parentOf, groupOf, queue, table] = [new Map<number, number>(rootPids.map((pid) => [pid, pid])), new Map<number, number>(), [...rootPids], readProcessTablePairs(procRoot)];
  do {
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      const tasks = process.platform === 'linux' || procRoot !== '/proc' ? directLinuxChildren(cur, procRoot) : [];
      for (const child of new Set([...tasks, ...table.filter((r) => r.ppid === cur).map((r) => r.pid)])) {
        if (!parentOf.has(child)) { parentOf.set(child, cur); queue.push(child); }
      }
    }
    for (const g of new Set([...parentOf.keys(), ...groupOf.keys(), ...groupHints])) if (g > 1 && g !== process.pid) for (const r of table) if (r.pgrp === g && r.pid !== g && !groupOf.has(r.pid)) { groupOf.set(r.pid, g); if (!parentOf.has(r.pid)) queue.push(r.pid); }
  } while (queue.length > 0);
  return { parentOf, groupOf };
}

function checkPidStatus(pid: number, expectedFp: string, procRoot = '/proc'): 'exited' | 'same' | 'unverified' {
  const cur = readPidFingerprint(pid, procRoot);
  if (cur === undefined || (expectedFp !== '' && cur !== null && cur !== expectedFp)) return 'exited';
  return expectedFp !== '' && cur === expectedFp ? 'same' : 'unverified';
}

async function waitForPidsExit(targets: ReadonlyArray<readonly [number, string]>, procRoot = '/proc'): Promise<void> {
  while (targets.some(([pid, fp]) => checkPidStatus(pid, fp, procRoot) !== 'exited')) await pollTick();
}

function killLaunchProcessGroup(proc: KillableProcess, procRoot = '/proc'): void {
  if (procRoot !== '/proc' || process.platform === 'win32' || hasExited(proc) || typeof proc.pid !== 'number' || proc.pid <= 0 || proc.pid === process.pid) return;
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* proc.kill يتكفل */ }
}

function hasMatchingMarkerInProc(pid: number, marker: string, procRoot = '/proc'): boolean {
  if (process.platform !== 'linux' && procRoot === '/proc') return false;
  try { return readFileSync(`${procRoot}/${pid}/environ`, 'utf8').split('\0').includes(`${LAUNCH_MARKER_ENV}=${marker}`); } catch { return false; }
}

function collectMarkedLinuxPids(marker: string | undefined, procRoot = '/proc'): number[] {
  if (marker === undefined || (process.platform !== 'linux' && procRoot === '/proc')) return [];
  return readLinuxProcessPairs(procRoot).filter((row) => hasMatchingMarkerInProc(row.pid, marker, procRoot)).map((row) => row.pid);
}

function signalDescendantPid(pid: number): Error | undefined {
  if (pid <= 0 || pid === process.pid) return undefined;
  try { process.kill(pid, 'SIGKILL'); return undefined; } catch (e) { return (e as { code?: unknown } | null)?.code === 'ESRCH' ? undefined : (e instanceof Error ? e : new Error('SIGKILL_FAILED')); }
}

const retainedDescendants = new WeakMap<KillableProcess, Map<number, string>>();
const rootFingerprints = new WeakMap<KillableProcess, string>();

function readPidFingerprint(pid: number, procRoot = '/proc'): string | null | undefined {
  if (!isPidAlive(pid, procRoot)) return undefined;
  if (process.platform === 'linux' || procRoot !== '/proc') {
    try {
      const stat = readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
      if (isLinuxStatZombie(stat)) return undefined;
      const end = stat.lastIndexOf(')');
      const start = end === -1 ? undefined : stat.slice(end + 1).trim().split(/\s+/)[19];
      return start !== undefined && start.length > 0 ? `linux:${start}` : `stat:${stat.trim()}`;
    } catch { return isPidAlive(pid, procRoot) ? null : undefined; }
  }
  if (process.platform !== 'darwin') return 'alive';
  try {
    const lstart = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1_000 }).trim();
    return lstart.length > 0 ? `darwin:${lstart}` : (isPidAlive(pid, procRoot) ? null : undefined);
  } catch { return isPidAlive(pid, procRoot) ? null : undefined; }
}

const isUnresolvedFp = (v: string): boolean => v === '' || v.startsWith('?');

function revalidateRetained(proc: KillableProcess, procRoot: string): { pids: number[]; unverifiedError: Error | undefined; unresolvedError: Error | undefined } {
  const prior = retainedDescendants.get(proc);
  if (prior === undefined) return { pids: [], unverifiedError: undefined, unresolvedError: undefined };
  const pids: number[] = [];
  let unverifiedError: Error | undefined;
  let unresolvedError: Error | undefined;
  for (const [pid, expectedFp] of prior) {
    const observedFp = expectedFp.startsWith('?') ? expectedFp.slice(1) : expectedFp;
    const status = checkPidStatus(pid, observedFp, procRoot);
    if (status === 'exited') {
      prior.delete(pid);
      if (!isUnresolvedFp(expectedFp) && readPidFingerprint(pid, procRoot) === undefined) pids.push(pid);
    } else if (!isUnresolvedFp(expectedFp) && status === 'same') pids.push(pid);
    else if (isUnresolvedFp(expectedFp)) unresolvedError ??= markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED'));
    else unverifiedError ??= markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED'));
  }
  if (prior.size === 0) retainedDescendants.delete(proc);
  return { pids, unverifiedError, unresolvedError };
}

function isParentLinkLive(childPid: number, parentPid: number, liveParents: ReadonlyMap<number, number>, procRoot: string): boolean {
  if (liveParents.get(childPid) === parentPid) return true;
  return (process.platform === 'linux' || procRoot !== '/proc') && directLinuxChildren(parentPid, procRoot).includes(childPid);
}

function hasVerifiedAncestry(pid: number, parentOf: ReadonlyMap<number, number>, groupOf: ReadonlyMap<number, number>, seedFps: ReadonlyMap<number, string>, liveParents: ReadonlyMap<number, number>, liveGroups: ReadonlyMap<number, number>, proc: KillableProcess, procRoot: string): boolean {
  const seen = new Set<number>();
  for (let cur = pid; !seen.has(cur); ) {
    seen.add(cur);
    const expectedFp = seedFps.get(cur);
    if (expectedFp !== undefined && !(cur === proc.pid && hasExited(proc)) && checkPidStatus(cur, expectedFp, procRoot) === 'same') return true;
    const parent = parentOf.get(cur);
    if (parent !== undefined && parent !== cur && isParentLinkLive(cur, parent, liveParents, procRoot)) { cur = parent; continue; }
    const group = groupOf.get(cur);
    if (group !== undefined && group !== cur && liveGroups.get(cur) === group) { cur = group; continue; }
    return false;
  }
  return false;
}

function readVerifiedFingerprint(pid: number, procRoot = '/proc'): string | null | undefined {
  for (let i = 0; i < 2; i += 1) { const fp = readPidFingerprint(pid, procRoot); if (fp !== null) return fp; }
  return readPidFingerprint(pid, procRoot);
}

function buildSeedFingerprints(proc: KillableProcess, rootPid: number | undefined, markedSet: ReadonlySet<number>, retainedSet: ReadonlySet<number>, marker: string | undefined, seeds: readonly number[], procRoot: string): { seedFps: Map<number, string>; seedErr: Error | undefined } {
  const prior = retainedDescendants.get(proc);
  const seedFps = new Map<number, string>();
  let seedErr: Error | undefined;
  for (const seed of seeds) {
    if (seed === rootPid && hasExited(proc)) continue;
    const fp = readVerifiedFingerprint(seed, procRoot);
    if (fp === undefined) continue;
    if (fp === null) { seedErr ??= markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED')); continue; }
    const okRoot = seed === rootPid && !hasExited(proc);
    const okRetained = retainedSet.has(seed) && prior?.get(seed) === fp;
    const okMarked = markedSet.has(seed) && marker !== undefined && hasMatchingMarkerInProc(seed, marker, procRoot);
    if (okRoot || okRetained || okMarked) { if (okRoot) rootFingerprints.set(proc, fp); seedFps.set(seed, fp); }
  }
  return { seedFps, seedErr };
}

function signalVerifiedDescendants(verified: ReadonlyArray<readonly [number, string]>, retained: Map<number, string>, initialError: Error | undefined, procRoot: string, signalPid: ((pid: number) => Error | undefined) | undefined): { waitPids: number[]; signalError: Error | undefined; holdRoot: boolean } {
  if (signalPid === undefined) return { waitPids: verified.map(([pid]) => pid), signalError: initialError, holdRoot: false };
  const statuses = verified.map(([pid, fp]) => [pid, checkPidStatus(pid, fp, procRoot)] as const);
  if (statuses.some(([, s]) => s === 'unverified')) return { waitPids: [], signalError: initialError ?? markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED')), holdRoot: true };
  const waitPids: number[] = [];
  let signalError = initialError;
  for (const [pid, status] of statuses) {
    if (status === 'exited') { retained.delete(pid); continue; }
    const err = signalPid(pid);
    if (err === undefined) waitPids.push(pid);
    else signalError ??= markUnconfirmedDescendants(err);
  }
  return { waitPids, signalError, holdRoot: false };
}

function terminateOwnedDescendants(proc: KillableProcess, procRoot = '/proc', signalPid?: (pid: number) => Error | undefined): { waitPids: number[]; signalError: Error | undefined; holdRoot: boolean } {
  const marker = launchedMarkers.get(proc);
  const rootPid = typeof proc.pid === 'number' && proc.pid > 0 ? proc.pid : undefined;
  const [rootAlive, markedPids, { pids: retainedPids, unverifiedError, unresolvedError }] = [rootPid !== undefined && !hasExited(proc), collectMarkedLinuxPids(marker, procRoot), revalidateRetained(proc, procRoot)];
  const rootFp = !rootAlive && rootPid !== undefined ? readPidFingerprint(rootPid, procRoot) : undefined;
  const keepGroup = !rootAlive && rootPid !== undefined && (rootFp === undefined || (rootFp !== null && (rootFp === rootFingerprints.get(proc) || (marker !== undefined && hasMatchingMarkerInProc(rootPid, marker, procRoot)))));
  const [seeds, groupHints] = [[...new Set([...(rootAlive && rootPid !== undefined ? [rootPid] : []), ...markedPids, ...retainedPids])], keepGroup && rootPid !== undefined ? [rootPid] : []];
  if (seeds.length === 0 && groupHints.length === 0) return { waitPids: [], signalError: unverifiedError ?? unresolvedError, holdRoot: false };
  const { seedFps, seedErr } = buildSeedFingerprints(proc, rootPid, new Set(markedPids), new Set(retainedPids), marker, seeds, procRoot);
  let signalError: Error | undefined = unverifiedError ?? seedErr;
  const [retainedSet, { parentOf, groupOf }] = [new Set(retainedPids), collectDescendantPids(seeds, procRoot, groupHints)];
  const retained = retainedDescendants.get(proc) ?? new Map<number, string>();
  const candidates: Array<readonly [number, string | null]> = [];
  for (const pid of new Set([...parentOf.keys(), ...groupOf.keys(), ...markedPids, ...retainedPids])) {
    if (pid === rootPid) continue;
    const fp = readVerifiedFingerprint(pid, procRoot);
    if (fp === undefined) retained.delete(pid);
    else candidates.push([pid, fp]);
  }
  const liveTable = readProcessTablePairs(procRoot);
  const [liveParents, liveGroups] = [new Map(liveTable.map((r) => [r.pid, r.ppid])), new Map(liveTable.map((r) => [r.pid, r.pgrp]))];
  const verified: Array<readonly [number, string]> = [];
  for (const [pid, fp] of candidates) {
    const own = (fp !== null && retainedSet.has(pid) && retained.get(pid) === fp) || (marker !== undefined && hasMatchingMarkerInProc(pid, marker, procRoot));
    if (!own && !hasVerifiedAncestry(pid, parentOf, groupOf, seedFps, liveParents, liveGroups, proc, procRoot)) {
      const cur = retained.get(pid);
      if (cur === undefined || isUnresolvedFp(cur)) retained.set(pid, fp === null ? '?' : `?${fp}`);
      signalError ??= markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED'));
      continue;
    }
    if (fp === null) { const cur = retained.get(pid); if (cur === undefined || isUnresolvedFp(cur)) retained.set(pid, '?'); signalError ??= markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED')); continue; }
    retained.set(pid, fp);
    verified.push([pid, fp]);
  }
  if (retained.size > 0) retainedDescendants.set(proc, retained);
  const holdRoot = [...retained.values()].some(isUnresolvedFp) || candidates.some(([, fp]) => fp === null);
  if (holdRoot) return { waitPids: [], signalError: signalError ?? markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED')), holdRoot };
  const result = signalVerifiedDescendants(verified, retained, signalError, procRoot, signalPid);
  if (retained.size === 0) retainedDescendants.delete(proc);
  return result;
}

function isRootGone(proc: KillableProcess, procRoot: string): boolean {
  if (hasExited(proc)) return true;
  if (typeof proc.pid !== 'number' || proc.pid <= 0) return false;
  const expectedFp = rootFingerprints.get(proc);
  return expectedFp !== undefined ? checkPidStatus(proc.pid, expectedFp, procRoot) === 'exited' : !isPidAlive(proc.pid, procRoot);
}

function killSingleAndWait(proc: KillableProcess, procRoot = '/proc'): Promise<void> | void {
  if (hasExited(proc)) return Promise.resolve();
  const isEsrch = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === 'ESRCH';
  const once = proc.once;
  if (typeof once !== 'function') {
    killLaunchProcessGroup(proc, procRoot);
    let ok: boolean;
    try { ok = proc.kill('SIGKILL'); }
    catch (e) { if (isEsrch(e) || isRootGone(proc, procRoot)) { confirmedExits.add(proc); return; } throw e; }
    if (isRootGone(proc, procRoot)) { confirmedExits.add(proc); return; }
    if (!ok) throw new Error('SIGKILL_REJECTED');
    if (typeof proc.pid !== 'number' || proc.pid <= 0) return;
    return (async () => { while (!isRootGone(proc, procRoot)) await pollTick(); confirmedExits.add(proc); })();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (): void => { if (!settled) { settled = true; confirmedExits.add(proc); proc.off?.('exit', finish); resolve(); } };
    const fail = (e: unknown): void => { if (!settled) { settled = true; proc.off?.('exit', finish); reject(e instanceof Error ? e : new Error('SIGKILL_FAILED')); } };
    once.call(proc, 'exit', finish);
    if (hasExited(proc)) return finish();
    try {
      killLaunchProcessGroup(proc, procRoot);
      const signaled = proc.kill('SIGKILL');
      if (isRootGone(proc, procRoot)) finish(); else if (!signaled) fail(new Error('SIGKILL_REJECTED'));
    } catch (e) { if (isEsrch(e) || isRootGone(proc, procRoot)) finish(); else fail(e); }
  });
}

function safeKillSingle(proc: KillableProcess, procRoot = '/proc'): Promise<void> | undefined {
  try { const res = killSingleAndWait(proc, procRoot); return res === undefined ? undefined : res; } catch (e) { return Promise.reject(e instanceof Error ? e : new Error('SIGKILL_FAILED')); }
}

/** يلتقط هويات التوابع المتحقَّق منها قبل بدء الإغلاق اللطيف لمنع فقدان النسب عند خروج الجذر. */
export function captureOwnedDescendants(proc: KillableProcess, procRoot = '/proc'): void { terminateOwnedDescendants(proc, procRoot, undefined); }

/** يقتل عملية Chromium الجذر ومجموعتها وكل شجرة توابعها مع توابع الإطلاق المؤكَّدة قبل فكّ قفل إعادة الإطلاق. */
export function killProcessTree(proc: KillableProcess, procRoot = '/proc', signalPid: ((pid: number) => Error | undefined) | undefined = procRoot === '/proc' ? signalDescendantPid : undefined): Promise<void> | void {
  const toErr = (e: unknown): Error => markUnconfirmedDescendants(e instanceof Error ? e : new Error('SIGKILL_FAILED'));
  const childTree = (proc.children ?? []).map((child) => { try { return killProcessTree(child, procRoot, signalPid)?.catch((e: unknown) => { throw toErr(e); }); } catch (e) { return Promise.reject(toErr(e)); } });
  const rootAlive = !hasExited(proc);
  const { waitPids, signalError, holdRoot } = terminateOwnedDescendants(proc, procRoot, signalPid);
  const hasRoot = typeof proc.pid === 'number' || rootAlive;
  const rootWait = holdRoot || !hasRoot ? undefined : (killLaunchProcessGroup(proc, procRoot), safeKillSingle(proc, procRoot));
  const waits: Array<Promise<void>> = childTree.filter((item): item is Promise<void> => item !== undefined);
  const waitTargets = waitPids.map((pid) => [pid, retainedDescendants.get(proc)?.get(pid) ?? ''] as const);
  if (waitTargets.length > 0) waits.push(waitForPidsExit(waitTargets, procRoot));
  if (signalError !== undefined) waits.push(Promise.reject(signalError));
  const shouldRescan = (): boolean => waitTargets.length > 0 || (rootAlive && hasExited(proc));
  if (rootWait === undefined && waits.length === 0) return shouldRescan() ? killProcessTree(proc, procRoot, signalPid) : undefined;
  return Promise.allSettled(rootWait === undefined ? waits : [rootWait, ...waits]).then((res) => {
    const errs = res.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    const chosen = errs.find((x) => hasUnconfirmedDescendants(x.reason)) ?? errs[0];
    if (chosen !== undefined) throw chosen.reason;
    return shouldRescan() ? killProcessTree(proc, procRoot, signalPid) : undefined;
  });
}
