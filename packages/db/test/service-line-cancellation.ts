import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { expect } from 'vitest';
import type { Database } from '../src/index.ts';
import type { Tx } from '../src/with-tenant.ts';
import {
  liveSql,
  PERFORMER_STAFF,
  performer,
  type ChangeCtx,
} from './service-line-performer-change.ts';

export type SlcPatch = {
  businessId?: string;
  price?: string;
  discount?: string;
  net?: string;
  reason?: string;
  role?: string | null;
  roleSystem?: boolean | null;
  roleName?: string | null;
};

export type CancelLine = {
  companyId: string;
  lineId: string;
  expectedRevision: number;
  cancelledBy: string;
  membershipId: string;
  cancellationId: string;
  reason?: string;
  cancellerNameEn?: string;
  cancellerNameAr?: string | null;
  cancellerRole?: string | null;
  cancellerRoleIsSystem?: boolean | null;
  cancellerRoleNameAr?: string | null;
  cancellerRoleNameEn?: string | null;
};

// الأرقام لا تتغير مع الإلغاء، فنسخة «قبل» تُقرأ من السطر بعد تحديث الحالة داخل نفس المعاملة حتى يلحق القيد المؤجّل.
export async function cancelServiceLine(tx: Tx, input: CancelLine): Promise<void> {
  const updated = await tx.execute(
    sql`UPDATE service_lines SET status='CANCELLED', revision=revision+1
      WHERE company_id=${input.companyId} AND id=${input.lineId} AND status='ACTIVE' AND revision=${input.expectedRevision}
      RETURNING id`,
  );
  if (updated.length !== 1) {
    throw new Error('service line cancel compare-and-set matched no row');
  }
  await tx.execute(
    sql`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
      previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
      canceller_name_ar,canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_ar,canceller_role_name_en)
    SELECT company_id,${input.cancellationId},business_id,id,revision,revision - 1,price,discount,net,
      ${input.cancelledBy},${input.membershipId},clock_timestamp(),${input.reason ?? 'Cancelled'},
      ${input.cancellerNameAr ?? null},${input.cancellerNameEn ?? 'Synthetic canceller'},
      ${input.cancellerRole ?? null},${input.cancellerRoleIsSystem ?? null},
      ${input.cancellerRoleNameAr ?? null},${input.cancellerRoleNameEn ?? null}
    FROM service_lines WHERE company_id=${input.companyId} AND id=${input.lineId}`,
  );
}

// صف التاريخ اليدوي يختبر الرفض فقط؛ الإلغاء المقبول يمر من cancelServiceLine حتى تبقى الأرقام منسوخة من السطر.
export function historySql(
  scope: { company: string; business: string; userId: string; membershipId: string },
  cancellationId: string,
  lineId: string,
  revision: number,
  previous: number,
  patch: SlcPatch = {},
) {
  return sql`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
    canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_en)
  VALUES(${scope.company},${cancellationId},${patch.businessId ?? scope.business},${lineId},${revision},${previous},
    ${patch.price ?? '1.000'},${patch.discount ?? '0.000'},${patch.net ?? '1.000'},${scope.userId},${scope.membershipId},
    clock_timestamp(),${patch.reason ?? 'Cancelled'},'Synthetic canceller',${patch.role ?? null},${patch.roleSystem ?? null},${patch.roleName ?? null})`;
}

export function pgError(error: unknown): {
  code?: string;
  constraint_name?: string;
  message?: string;
} {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code !== undefined || candidate.constraint_name !== undefined) return candidate;
    current = candidate.cause;
  }
  return {};
}

export async function refused(work: Promise<unknown>, constraint: string, code = '23514') {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect([pgError(error).code, pgError(error).constraint_name]).toEqual([code, constraint]);
  return pgError(error).message;
}

const PROBE = 'probe rollback';

const caught = (work: Promise<unknown>) =>
  work.then(
    () => null,
    (error: unknown) => error,
  );

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function untilLocked(owner: postgres.Sql, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await owner`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
    if (row?.['wait_event_type'] === 'Lock') return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error('the second transaction never waited on the line lock');
}

async function releaseAfterLock(
  owner: postgres.Sql,
  pidReady: Promise<number>,
  aborted: Promise<number>,
  markSeen: () => void,
  release: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<number>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('the second transaction never reached the line lock')),
      3000,
    );
  });
  let pollError: unknown;
  try {
    const pid = await Promise.race([pidReady, aborted, expired]);
    markSeen();
    await untilLocked(owner, pid);
  } catch (error) {
    pollError = error;
  } finally {
    clearTimeout(timer);
    release();
  }
  if (pollError !== undefined) throw pollError;
}

type Pair = {
  done: Promise<[unknown, unknown]>;
  pid: Promise<number>;
  aborted: Promise<number>;
  release: () => void;
  mark: () => void;
};

function startPair(
  db: Database,
  ctx: ChangeCtx,
  hold: (tx: Tx) => Promise<void>,
  during: (tx: Tx) => Promise<void>,
  follow: (tx: Tx) => Promise<void>,
): Pair {
  const locked = gate();
  const release = gate();
  let reportPid: (pid: number) => void = () => undefined;
  const pid = new Promise<number>((resolve) => {
    reportPid = resolve;
  });
  let abort: (error: unknown) => void = () => undefined;
  const aborted = new Promise<number>((_, reject) => {
    abort = reject;
  });
  let sawPid = false;
  const first = db.withTenant(
    ctx.company,
    async (tx) => {
      await hold(tx);
      locked.open();
      await release.promise;
      await during(tx);
      throw new Error(PROBE);
    },
    { userId: ctx.userId },
  );
  const second = locked.promise.then(() =>
    db.withTenant(
      ctx.company,
      async (tx) => {
        const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        if (backend === undefined) throw new Error('lock probe backend missing');
        reportPid(Number(backend.pid));
        await follow(tx);
      },
      { userId: ctx.userId },
    ),
  );
  const ignore = (error: unknown) => {
    if (!sawPid) abort(error);
  };
  void first.catch(ignore);
  void second.catch(ignore);
  return {
    done: Promise.all([caught(first), caught(second)]),
    pid,
    aborted,
    release: release.open,
    mark: () => {
      sawPid = true;
    },
  };
}

// الأولى ما تسيبش السطر إلا بعد ما الثانية تبان مستنية عليه؛ غير كده الاختبار يعدّي وهو متسلسل.
async function holdLine(
  db: Database,
  owner: postgres.Sql,
  ctx: ChangeCtx,
  hold: (tx: Tx) => Promise<void>,
  during: (tx: Tx) => Promise<void>,
  follow: (tx: Tx) => Promise<void>,
): Promise<[unknown, unknown]> {
  const pair = startPair(db, ctx, hold, during, follow);
  let pollError: unknown;
  try {
    await releaseAfterLock(owner, pair.pid, pair.aborted, pair.mark, pair.release);
  } catch (error) {
    pollError = error;
  }
  const done = await pair.done;
  if (pollError !== undefined) throw pollError;
  return done;
}

async function lineState(owner: postgres.Sql, lineId: string) {
  const [line] = await owner`SELECT status, revision FROM service_lines WHERE id=${lineId}`;
  const [history] =
    await owner`SELECT count(*)::int AS n FROM service_line_cancellations WHERE line_id=${lineId}`;
  const [performers] =
    await owner`SELECT count(*)::int AS n FROM line_performers WHERE line_id=${lineId}`;
  return {
    status: line?.['status'],
    revision: Number(line?.['revision']),
    history: Number(history?.['n']),
    performers: Number(performers?.['n']),
  };
}

const extraPerformer = (ctx: ChangeCtx, lineId: string, id: string) =>
  liveSql(
    ctx,
    id,
    lineId,
    performer(PERFORMER_STAFF.emp2, { ordinal: 2, share: 1, nameEn: 'Extra' }),
  );

export async function performerWarningLockCodes(
  db: Database,
  owner: postgres.Sql,
  ctx: ChangeCtx,
  ids: { newId(): string },
  lineId: string,
): Promise<void> {
  const insert = (tx: Tx) =>
    tx.execute(extraPerformer(ctx, lineId, ids.newId())).then(() => undefined);
  const warn = (tx: Tx) =>
    tx
      .execute(
        sql`UPDATE service_lines SET has_performer_warning = NOT has_performer_warning
        WHERE company_id=${ctx.company} AND id=${lineId}`,
      )
      .then(() => undefined);
  const [first, second] = await holdLine(db, owner, ctx, insert, warn, async (tx) => {
    await insert(tx);
    await warn(tx);
    throw new Error(PROBE);
  });
  expect([first, second].map((error) => (error instanceof Error ? error.message : error))).toEqual([
    PROBE,
    PROBE,
  ]);
  expect([pgError(first).code, pgError(second).code]).toEqual([undefined, undefined]);
  expect(await lineState(owner, lineId)).toEqual({
    status: 'ACTIVE',
    revision: 1,
    history: 0,
    performers: 1,
  });
}

export async function cancelBehindPerformerInsert(
  db: Database,
  owner: postgres.Sql,
  ctx: ChangeCtx,
  ids: { newId(): string },
  lineId: string,
): Promise<void> {
  const [first, second] = await holdLine(
    db,
    owner,
    ctx,
    (tx) => tx.execute(extraPerformer(ctx, lineId, ids.newId())).then(() => undefined),
    async () => undefined,
    (tx) =>
      cancelServiceLine(tx, {
        companyId: ctx.company,
        lineId,
        expectedRevision: 1,
        cancelledBy: ctx.userId,
        membershipId: ctx.membershipId,
        cancellationId: ids.newId(),
      }),
  );
  expect(first instanceof Error ? first.message : first).toBe(PROBE);
  expect(pgError(first).code).toBeUndefined();
  expect(second).toBeNull();
  expect(await lineState(owner, lineId)).toEqual({
    status: 'CANCELLED',
    revision: 2,
    history: 1,
    performers: 1,
  });
}
