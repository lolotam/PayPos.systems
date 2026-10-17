import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { systemUuidV7 } from '@pospay/ids';

import { assignEmployeeNumber } from '../persistence/employee-number-allocator.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  detailFor,
  termsFor,
  employeeUserMembership,
  type EmployeeFixture,
} from './employees.fixture.ts';

const dialect = new PgDialect();

const ids = systemUuidV7();
export { grantEmployeeCreation, detailFor, termsFor, employeeUserMembership, type EmployeeFixture };
export const employeeNumberIds = ids;

export function assignFixture() {
  return employeesFixture();
}

export async function provisionEmployer(f: EmployeeFixture, label: string) {
  const companyId = await f.h.onboard(f.cookie, label);
  const businessId = ids.newId();
  const branchId = ids.newId();
  await f.h
    .owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${companyId},${businessId},${label},'salon')`;
  await f.h
    .owner`INSERT INTO branches (company_id,id,business_id,name_en) VALUES (${companyId},${branchId},${businessId},${label})`;
  return { companyId, businessId, branchId };
}

export async function readCounter(f: EmployeeFixture, companyId = f.company) {
  const [row] = await f.h
    .owner`SELECT next_number FROM employee_number_sequences WHERE company_id=${companyId}`;
  return row === undefined ? null : Number(row['next_number']);
}

export async function setCounter(f: EmployeeFixture, next: number, companyId = f.company) {
  await f.h.owner`INSERT INTO employee_number_sequences (company_id, next_number)
    VALUES (${companyId}, ${next})
    ON CONFLICT (company_id) DO UPDATE SET next_number = ${next}, updated_at = now()`;
}

export async function insertHeldNumbers(
  f: EmployeeFixture,
  start: number,
  count: number,
  options: {
    companyId?: string;
    businessId?: string;
    branchId?: string;
    deleted?: boolean;
  } = {},
) {
  const companyId = options.companyId ?? f.company;
  const businessId = options.businessId ?? f.business;
  const branchId = options.branchId ?? f.branch;
  await f.h.owner`INSERT INTO employees (
      company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date,
      employee_number, deleted_at)
    SELECT ${companyId}, gen_random_uuid(), ${businessId}, ${branchId},
      'Held ' || g::text, 'held-' || g::text, 'staff', '2020-01-01', ${start} + g - 1,
      CASE WHEN ${options.deleted === true} THEN now() ELSE NULL END
    FROM generate_series(1, ${count}) AS g`;
}

export function executeCreate(
  f: EmployeeFixture,
  name: string,
  extra: {
    companyId?: string;
    businessId?: string;
    branchId?: string;
    primary_branch_id?: string;
    user_id?: string;
  } = {},
) {
  return f.useCase.execute({
    companyId: extra.companyId ?? f.company,
    userId: f.userId,
    businessId: extra.businessId ?? f.business,
    input: {
      primary_branch_id: extra.primary_branch_id ?? extra.branchId ?? f.branch,
      name_en: name,
      role_code: 'staff',
      hire_date: '2026-01-01',
      ...(extra.user_id === undefined ? {} : { user_id: extra.user_id }),
    },
  });
}

export function sendCreate(
  f: EmployeeFixture,
  body: object,
  business = f.business,
  company = f.company,
) {
  return f.h.send('POST', `/v1/businesses/${business}/employees`, {
    cookie: f.cookie,
    company,
    body,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function releaseOnce(gate: { resolve: () => void }) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    gate.resolve();
  };
}

// الإيقاف بعد تنفيذ FOR UPDATE وقبل تحديث العدّاد، لأن تحديث الصف كان سيحجز المعاملة الثانية حتى لو حُذف القفل.
function holdOnSequenceLock(tx: Tx, release: Promise<void>, held: () => void): Tx {
  let armed = false;
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property !== 'execute') return Reflect.get(target, property, receiver);
      return async (query: SQL) => {
        const result = await target.execute(query);
        const text = dialect.sqlToQuery(query).sql;
        if (!armed && /employee_number_sequences/i.test(text) && /FOR UPDATE/i.test(text)) {
          armed = true;
          held();
          await release;
        }
        return result;
      };
    },
  });
}

async function waitForAppLock(f: EmployeeFixture, pattern: RegExp): Promise<string> {
  let seen = '';
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await f.h.owner<{ query: string }[]>`
      SELECT query FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = 'pospay_app'
        AND wait_event_type = 'Lock'
        AND pid <> pg_backend_pid()`;
    seen = rows.map((row) => row.query).join('\n');
    const waiting = rows.find((row) => pattern.test(row.query));
    if (waiting !== undefined) return waiting.query;
  }
  throw new Error(`no locked backend matched ${pattern}; saw: ${seen}`);
}

export async function allocationsSharingTheCounterLock(f: EmployeeFixture, companyId: string) {
  const gate = deferred();
  const holding = deferred();
  const finish = releaseOnce(gate);
  const followers: Promise<number>[] = [];
  const first = f.db.withTenant(
    companyId,
    (tx) => assignEmployeeNumber(holdOnSequenceLock(tx, gate.promise, holding.resolve), companyId),
    { userId: f.userId },
  );
  const finished = first.then(
    () => 'finished' as const,
    (error: unknown) => {
      finish();
      throw error;
    },
  );
  try {
    const gateResult = await Promise.race([holding.promise.then(() => 'held' as const), finished]);
    if (gateResult !== 'held') throw new Error('allocator finished without FOR UPDATE');
    const second = f.db.withTenant(companyId, (tx) => assignEmployeeNumber(tx, companyId), {
      userId: f.userId,
    });
    followers.push(second);
    await waitForAppLock(f, /employee_number_sequences/i);
    finish();
    return await Promise.all([first, second]);
  } finally {
    finish();
    await Promise.allSettled([first, ...followers]);
  }
}

export async function firstSequenceSeedRace(
  f: EmployeeFixture,
  companyId: string,
  outcome: 'commit' | 'rollback',
) {
  const gate = deferred();
  const holding = deferred();
  const finish = releaseOnce(gate);
  const followers: Promise<number>[] = [];
  const first = f.db.withTenant(
    companyId,
    async (tx) => {
      const number = await assignEmployeeNumber(tx, companyId);
      holding.resolve();
      await gate.promise;
      if (outcome === 'rollback') throw new Error('synthetic rollback');
      return number;
    },
    { userId: f.userId },
  );
  const settled = first.then(
    (number) => ({ ok: true as const, number }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    const gateResult = await Promise.race([
      holding.promise.then(() => 'held' as const),
      settled.then((result) => result),
    ]);
    if (gateResult !== 'held') throw new Error('first seed ended before the hold');
    const second = f.db.withTenant(companyId, (tx) => assignEmployeeNumber(tx, companyId), {
      userId: f.userId,
    });
    followers.push(second);
    await waitForAppLock(f, /insert into employee_number_sequences/i);
    finish();
    const [leader, follower] = await Promise.all([settled, second]);
    if (!leader.ok) {
      if (outcome !== 'rollback') throw leader.error;
      return { first: null, second: follower };
    }
    return { first: leader.number, second: follower };
  } finally {
    finish();
    await Promise.allSettled([first, ...followers]);
  }
}

export async function createdCounts(f: EmployeeFixture, companyId = f.company) {
  const [employees] = await f.h
    .owner`SELECT count(*) AS n FROM employees WHERE company_id=${companyId}`;
  const [attachments] = await f.h
    .owner`SELECT count(*) AS n FROM employee_branches WHERE company_id=${companyId}`;
  const [audits] = await f.h
    .owner`SELECT count(*) AS n FROM audit_log WHERE company_id=${companyId} AND entity='employee' AND action='created'`;
  return { employees, attachments, audits };
}
