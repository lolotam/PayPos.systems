import {
  COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX,
  type CommissionPlanEmployeeListQuery,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { expect, it, vi } from 'vitest';

import { ApiError } from '../../../shared/errors.ts';
import { CommissionPlanEmployeesController } from '../http/commission-plan-employees.controller.ts';
import {
  CommissionPlanEmployeeReadError,
  listCommissionPlanEmployees,
  type CommissionPlanEmployeeListReads,
  type CommissionPlanEmployeeRow,
} from '../queries/commission-plan-employees.query.ts';

const scope = {
  companyId: '01920000-0000-7000-8000-000000000501',
  userId: '01920000-0000-7000-8000-000000000502',
  businessId: '01920000-0000-7000-8000-000000000503',
};
const tx = {} as Tx;

function row(id: string, key: string): CommissionPlanEmployeeRow {
  return {
    id,
    name_ar: null,
    name_en: 'Stored key employee',
    employee_number: 1,
    name_en_key: key,
  };
}

const first = row('01920000-0000-7000-8000-0000000005a1', '');
const second = row('01920000-0000-7000-8000-0000000005a2', 'zz');

function readsOf(rows: readonly CommissionPlanEmployeeRow[]): CommissionPlanEmployeeListReads {
  return {
    access: async () => null,
    timeZone: async () => 'Asia/Kuwait',
    employeeNames: async () => rows,
  };
}

function list(
  rows: readonly CommissionPlanEmployeeRow[],
  query: Partial<CommissionPlanEmployeeListQuery> = {},
) {
  return listCommissionPlanEmployees(readsOf(rows), tx, scope, { limit: 1, ...query });
}

// مع المعرّفات دي الـ JSON الثابت 143 بايت، فمفتاح ASCII طوله 9073 بيدّي 9216 بايت = 12288 حرف
// بالظبط، والحرف اللي بعده بيقفز لـ 12290: مفيش مؤشر طوله 12289.
it('PP-122 a continuation cursor of exactly the cap is returned', async () => {
  const page = await list([{ ...first, name_en_key: 'k'.repeat(9073) }, second]);
  expect(page.next_cursor).toHaveLength(COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX);
  expect(page.items.map((item) => item.id)).toEqual([first.id]);
});

it.each([
  ['the first length past the cap', 'k'.repeat(9074)],
  ['a stored key of 10000 characters', 'k'.repeat(10_000)],
])('PP-122 %s refuses the page with the typed stored-data error', async (_label, key) => {
  const refused = list([{ ...first, name_en_key: key }, second]);
  await expect(refused).rejects.toBeInstanceOf(CommissionPlanEmployeeReadError);
  await expect(refused).rejects.toMatchObject({
    code: 'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE',
  });
});

it('PP-122 a terminal page lists a long stored key, because no cursor has to be encoded', async () => {
  const page = await list([{ ...first, name_en_key: 'k'.repeat(10_000) }], { limit: 2 });
  expect(page.items.map((item) => item.id)).toEqual([first.id]);
  expect(page.next_cursor).toBeNull();
});

function controllerFailingWith(code: CommissionPlanEmployeeReadError['code']) {
  const warn = vi.fn();
  const runner = async () => {
    throw new CommissionPlanEmployeeReadError(code);
  };
  const request = { principal: scope, log: { warn } } as unknown as FastifyRequest;
  const call = new CommissionPlanEmployeesController(runner).listPlanEmployees(
    scope.businessId,
    { limit: 1 },
    request,
  );
  return { call, warn };
}

it('PP-122 the stored-data refusal is a 503 and is logged once with its code only', async () => {
  const { call, warn } = controllerFailingWith('COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE');
  const error = await call.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect([(error as ApiError).status, (error as ApiError).code]).toEqual([
    503,
    'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE',
  ]);
  expect(warn.mock.calls).toEqual([
    [
      { code: 'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE' },
      'commission plan employee cursor unavailable',
    ],
  ]);
});

it('PP-122 a client cursor refusal stays a 400 and is not logged', async () => {
  const { call, warn } = controllerFailingWith('VALIDATION_FAILED');
  await expect(call).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  expect(warn).not.toHaveBeenCalled();
});
