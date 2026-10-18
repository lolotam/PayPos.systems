import type { RecordSessionTipsInput } from '@pospay/contracts';
import { cancelServiceLine } from '../../../packages/db/test/service-line-cancellation.ts';
import postgres from 'postgres';
import { expect } from 'vitest';
import { ordersSessionTips } from '../src/modules/orders/orders.module.ts';
import { RecordSessionTipsUseCase } from '../src/modules/orders/use-cases/record-session-tips/record-session-tips.usecase.ts';
import { ids, must, sessionFixture, type SessionFixture } from './service-session.fixture.ts';

export { AT, ids, interceptDatabase, must } from './service-session.fixture.ts';

type VisitLine = Parameters<SessionFixture['body']>[0];
type TipPatch = { expected_revision?: number; reason?: string; recorder_membership_id?: string };
type TipRunOptions = {
  userId?: string;
  key?: string;
  fingerprint?: string;
  companyId?: string;
  businessId?: string;
  branchId?: string;
};

/** زيارة مسجّلة مع حالة استخدام البقشيش، فوق sessionFixture من غير تغيير سلوكه. */
export async function tipFixture(options: Parameters<typeof sessionFixture>[0] = {}) {
  const base = await sessionFixture(options);
  const tips = new RecordSessionTipsUseCase(ordersSessionTips(base.db), ids, base.clock);
  return {
    ...base,
    tips,
    linkEmployee: (employeeId: string, linkedUser: string | null) =>
      base.h
        .owner`UPDATE employees SET user_id=${linkedUser} WHERE company_id=${base.company} AND id=${employeeId}`,
    snapshotPerformers: (
      lineId: string,
      rows: {
        employee_id: string;
        linked_user_id: string | null;
        linked_user_snapshotted: boolean;
      }[],
    ) => applyPerformerSnapshot(base, lineId, rows),
  };
}

export type TipFixture = Awaited<ReturnType<typeof tipFixture>>;

export function tipInput(
  tips: RecordSessionTipsInput['tips'],
  patch: TipPatch = {},
): RecordSessionTipsInput {
  return {
    expected_revision: patch.expected_revision ?? 0,
    tips,
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    ...(patch.recorder_membership_id === undefined
      ? {}
      : { recorder_membership_id: patch.recorder_membership_id }),
  };
}

export function tip(
  f: SessionFixture,
  employeeIndex: number,
  method: 'CASH' | 'CARD',
  amount: string,
) {
  return { employee_id: must(f.employees[employeeIndex]), method, amount };
}

export function pairLine(f: SessionFixture) {
  const line = f.line(must(f.services[0]), '25.000', '0.000');
  return {
    ...line,
    performers: [{ employee_id: must(f.employees[0]) }, { employee_id: must(f.employees[1]) }],
  };
}

export function twoLines(f: SessionFixture) {
  const second = f.line(must(f.services[1]), '7.125', '0.000');
  return [
    f.line(must(f.services[0]), '25.000', '0.000'),
    { ...second, performers: [{ employee_id: must(f.employees[1]) }] },
  ];
}

export async function recordVisit(f: TipFixture, lines?: VisitLine) {
  return recordVisitAt(f, undefined, lines);
}

export async function recordVisitAt(
  f: TipFixture,
  occurredAt: string | undefined,
  lines?: VisitLine,
) {
  const body = f.body(lines ?? [f.line(must(f.services[0]), '25.000', '0.000')]);
  const result = await f.create.execute({
    ...f.context(),
    input: occurredAt === undefined ? body : { ...body, occurred_at: occurredAt },
  });
  return { sessionId: result.session.id, lineIds: result.session.lines.map((line) => line.id) };
}

export function runTips(
  f: TipFixture,
  sessionId: string,
  input: RecordSessionTipsInput,
  options: TipRunOptions = {},
) {
  return f.tips.execute({
    companyId: options.companyId ?? f.company,
    userId: options.userId ?? f.userId,
    businessId: options.businessId ?? f.business,
    branchId: options.branchId ?? f.branch,
    key: options.key ?? ids.newId(),
    fingerprint: options.fingerprint ?? 'a'.repeat(64),
    sessionId,
    input,
  });
}

export function cancelLine(f: TipFixture, lineId: string) {
  return f.db.withTenant(
    f.company,
    (tx) =>
      cancelServiceLine(tx, {
        companyId: f.company,
        lineId,
        expectedRevision: 1,
        cancelledBy: f.userId,
        membershipId: f.membership,
        cancellationId: ids.newId(),
      }),
    { userId: f.userId },
  );
}

export async function tipRows(f: TipFixture, sessionId: string) {
  const revisions = await f.h
    .owner`SELECT id,revision,previous_revision,event_id,changed_by,changed_by_membership_id,reason,xmin::text AS xmin
    FROM session_tip_revisions WHERE company_id=${f.company} AND session_id=${sessionId} ORDER BY revision`;
  const entries = await f.h.owner`SELECT revision_id,employee_id,method,amount::text AS amount
    FROM session_tips WHERE company_id=${f.company} AND session_id=${sessionId} ORDER BY employee_id,method`;
  const audits = await f.h.owner`SELECT action,before,after,xmin::text AS xmin
    FROM audit_log WHERE company_id=${f.company} AND entity='service_session_tips' AND entity_id=${sessionId} ORDER BY action`;
  const events = await f.h.owner`SELECT id,payload,xmin::text AS xmin
    FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='SessionTipsChanged'`;
  return { revisions, entries, audits, events };
}

export async function tipQuiet(f: TipFixture, sessionId: string, key: string) {
  const revisions = await f.h
    .owner`SELECT 1 FROM session_tip_revisions WHERE company_id=${f.company} AND session_id=${sessionId}`;
  const entries = await f.h
    .owner`SELECT 1 FROM session_tips WHERE company_id=${f.company} AND session_id=${sessionId}`;
  const audits = await f.h
    .owner`SELECT 1 FROM audit_log WHERE company_id=${f.company} AND entity='service_session_tips' AND entity_id=${sessionId}`;
  const events = await f.h
    .owner`SELECT 1 FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='SessionTipsChanged'`;
  const keys = await f.h
    .owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  return {
    revisions: revisions.length,
    entries: entries.length,
    audits: audits.length,
    events: events.length,
    keys: keys.length,
  };
}

/** العدّ مطلق، فالمساواة قبل النداء وبعده تثبت أن الرفض لم يزد صفاً حتى لو كانت الزيارة فيها سطور. */
export async function refusedTips(
  f: TipFixture,
  sessionId: string,
  input: RecordSessionTipsInput,
  options: TipRunOptions = {},
) {
  const key = options.key ?? ids.newId();
  const before = await tipQuiet(f, sessionId, key);
  const error = await caught(runTips(f, sessionId, input, { ...options, key }));
  expect(await tipQuiet(f, sessionId, key)).toEqual(before);
  if (error === null) throw new Error('expected a refusal');
  return errorShape(error);
}

export async function sessionRevisionCount(f: TipFixture, sessionId: string) {
  const rows = await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE session_id=${sessionId}`;
  return rows.length;
}

export const caught = async (work: Promise<unknown>) =>
  work.then(
    () => null,
    (error: unknown) => error,
  );

export function causeChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  for (
    let current = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    parts.push(current instanceof Error ? `${current.name}:${current.message}` : String(current));
  }
  return parts.join('\n');
}

export function errorShape(error: unknown) {
  const session = error as { code?: string; message?: string; details?: unknown };
  return { code: session.code, message: session.message, details: session.details };
}

export async function holdVisit(f: TipFixture, sessionId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: (pid: number) => void;
  const acquired = new Promise<number>((resolve) => {
    locked = resolve;
  });
  const holder = f.h.owner.begin(async (tx) => {
    const [me] = await tx`SELECT pg_backend_pid() AS pid`;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${f.company}::uuid::text || ':service_session:' || ${sessionId}::uuid::text,0))`;
    locked(Number(me?.['pid']));
    await released;
  });
  const pid = await acquired;
  let done = false;
  return {
    pid,
    release: async () => {
      if (done) return;
      done = true;
      release();
      await holder;
    },
  };
}

export async function holdEmployeeUpdate(f: TipFixture, employeeId: string, userId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: (pid: number) => void;
  const acquired = new Promise<number>((resolve) => {
    locked = resolve;
  });
  const holder = f.h.owner.begin(async (tx) => {
    const [me] = await tx`SELECT pg_backend_pid() AS pid`;
    await tx`SELECT id FROM employees WHERE company_id=${f.company} AND id=${employeeId} FOR UPDATE`;
    locked(Number(me?.['pid']));
    await released;
    await tx`UPDATE employees SET user_id=${userId} WHERE company_id=${f.company} AND id=${employeeId}`;
  });
  const pid = await acquired;
  let done = false;
  return {
    pid,
    commit: async () => {
      if (done) return;
      done = true;
      release();
      await holder;
    },
  };
}

export function separateOwner(f: TipFixture) {
  return postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
}

export async function waitForBlocked(
  f: TipFixture,
  holderPid: number,
  needed: number,
  waitEvent?: string,
) {
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const start = Date.now();
  try {
    while (Date.now() - start < 2000) {
      const rows = await observer`SELECT pid,wait_event,query FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND ${holderPid}=ANY(pg_blocking_pids(pid))`;
      const matched =
        waitEvent === undefined ? rows : rows.filter((row) => row['wait_event'] === waitEvent);
      if (matched.length >= needed) return matched;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return [];
  } finally {
    await observer.end();
  }
}

export async function waitForAdvisory(f: TipFixture, holderPid: number, needed: number) {
  return (await waitForBlocked(f, holderPid, needed, 'advisory')).length;
}

export function payloadOf(value: unknown): unknown {
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

async function applyPerformerSnapshot(
  base: SessionFixture,
  lineId: string,
  rows: readonly {
    employee_id: string;
    linked_user_id: string | null;
    linked_user_snapshotted: boolean;
  }[],
) {
  for (const row of rows) {
    await base.h
      .owner`UPDATE line_performers SET linked_user_id=${row.linked_user_id}, linked_user_snapshotted=${row.linked_user_snapshotted}
      WHERE company_id=${base.company} AND line_id=${lineId} AND employee_id=${row.employee_id}`;
  }
}
