import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildOpenApiDocument, leaveHistoryReportAccepted } from '@pospay/contracts';
import {
  defaultReportRequestPayload,
  leaveFixture,
  postReportRequestHttp,
  type LeaveFixture,
} from './leave-history-report-request.fixture.ts';

let f: LeaveFixture;

beforeAll(async () => {
  f = await leaveFixture();
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('refuses forbidden request body keys with 400 VALIDATION_FAILED', async () => {
  const rejectedBodies = [
    { name: 'employee_id', payload: { ...defaultReportRequestPayload, employee_id: f.employee.id } },
    { name: 'cursor', payload: { ...defaultReportRequestPayload, cursor: 'any-cursor' } },
    { name: 'limit', payload: { ...defaultReportRequestPayload, limit: 10 } },
    { name: 'unknown_key', payload: { ...defaultReportRequestPayload, unexpected: true } },
    { name: 'from_after_to', payload: { ...defaultReportRequestPayload, from: '2026-10-01', to: '2026-09-01' } },
    { name: 'range_over_366_days', payload: { ...defaultReportRequestPayload, from: '2026-01-01', to: '2027-01-03' } },
    { name: 'invalid_type_enum', payload: { ...defaultReportRequestPayload, 'types[]': ['NONEXISTENT'] } },
    { name: 'invalid_status_enum', payload: { ...defaultReportRequestPayload, 'statuses[]': ['INVALID'] } },
  ];

  for (const { name, payload } of rejectedBodies) {
    const res = await postReportRequestHttp(f, payload);
    expect(res.statusCode, `expected 400 for ${name}`).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
  }
});

it('accepts valid 202 matching LeaveHistoryReportAccepted and lower-cases uppercase branch_id', async () => {
  await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
  const uppercaseBranch = f.branch.toUpperCase();
  const res = await postReportRequestHttp(f, {
    ...defaultReportRequestPayload,
    branch_id: uppercaseBranch,
  });

  expect(res.statusCode).toBe(202);
  const accepted = leaveHistoryReportAccepted.parse(res.json());
  expect(accepted.report_id).toBeDefined();

  const [row] = await f.h
    .owner`SELECT query FROM leave_history_reports WHERE company_id = ${f.company} AND id = ${accepted.report_id}`;
  const query = row?.['query'] as { branch_id?: string };
  expect(query.branch_id).toBe(f.branch.toLowerCase());
});

it('maintains warm acceptance p95 under 200 ms across 30 requests with distinct filters', async () => {
  const times: number[] = [];

  for (let i = 1; i <= 30; i++) {
    await f.h.owner`DELETE FROM leave_history_reports WHERE company_id = ${f.company}`;
    const day = String(i).padStart(2, '0');
    const start = performance.now();
    const res = await postReportRequestHttp(f, {
      from: '2026-01-01',
      to: `2026-01-${day}`,
      'types[]': ['ANNUAL'],
      'statuses[]': ['APPROVED'],
    });
    times.push(performance.now() - start);
    expect(res.statusCode).toBe(202);
    expect(leaveHistoryReportAccepted.safeParse(res.json()).success).toBe(true);
  }

  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
  expect(p95).toBeLessThan(200);
});

it('contains both leave-history report paths and operation ids in the OpenAPI document', () => {
  const doc = buildOpenApiDocument() as {
    paths?: Record<string, Record<string, { operationId?: string }>>;
  };
  const paths = doc.paths ?? {};

  const requestPath = paths['/v1/businesses/{businessId}/leave-history/reports'];
  expect(requestPath?.post?.operationId).toBe('requestLeaveHistoryReport');

  const resultPath = paths['/v1/businesses/{businessId}/leave-history/reports/{reportId}'];
  expect(resultPath?.get?.operationId).toBe('getLeaveHistoryReportResult');
});
