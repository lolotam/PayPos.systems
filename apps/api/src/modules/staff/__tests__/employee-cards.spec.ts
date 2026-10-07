import { deriveEmployeeCardKey } from '@pospay/auth';
import { IdempotencyKeyReusedError } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmployeeCards } from '../persistence/drizzle-employee-cards.ts';
import { createEmployeeCardAccess } from '../persistence/employee-card-access.adapter.ts';
import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';
import { RevokeEmployeeCard } from '../use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
const cardKey = deriveEmployeeCardKey('test-secret-that-is-long-enough-for-hmac');
let f: EmployeeFixture;
let employeeId: string;
let colleagueId: string;

beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
  const hire = (name: string) =>
    f.useCase.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f, name),
    });
  employeeId = (await hire('Synthetic employee')).id;
  colleagueId = (await hire('Card colleague')).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const cardsPath = (employee = employeeId) =>
  `/v1/businesses/${f.business}/employees/${employee}/cards`;
const send = (method: 'GET' | 'POST', path: string, body?: object, key?: string) =>
  f.h.send(method, path, {
    cookie: f.cookie,
    company: f.company,
    ...(key === undefined ? {} : { key }),
    ...(body === undefined ? {} : { body }),
  });
const list = (employee = employeeId) => send('GET', cardsPath(employee));
const issue = (employee: string, code: string) =>
  send('POST', cardsPath(employee), { card_code: code }, ids.newId());
const issueWith = (employee: string, code: string, key: string) =>
  send('POST', cardsPath(employee), { card_code: code }, key);
const revoke = (employee: string, cardId: string, key = ids.newId()) =>
  send('POST', `${cardsPath(employee)}/${cardId}/revoke`, undefined, key);
const auditFor = (cardId: string) =>
  f.h.owner`SELECT action, before, after FROM audit_log
    WHERE company_id=${f.company} AND entity='employee_card' AND entity_id=${cardId} ORDER BY action`;

async function grants(rows: readonly ['ALLOW' | 'DENY', 'BUSINESS' | 'BRANCH', string][]) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company}
    AND membership_id=${f.memberId} AND permission_code='manage:employees:business'`;
  for (const [effect, scope, scopeId] of rows) {
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${f.memberId},'manage:employees:business',${effect},${scope},${scopeId},'Synthetic card scope',${f.userId})`;
  }
}

async function sameAsMissing(
  run: (employee: string) => Promise<{ status: number; body: Record<string, unknown> }>,
) {
  const refused = await run(employeeId);
  const missing = await run(ids.newId());
  expect(refused.status).toBe(404);
  expect(refused.body).toEqual(missing.body);
  expect(refused.body['code']).toBe('NOT_FOUND');
}

it('business ALLOW plus branch DENY hides list, issue and revoke like a missing employee', async () => {
  await grants([['ALLOW', 'BUSINESS', f.business]]);
  const issued = await issue(employeeId, 'CARD-OK-1001');
  expect(issued.status).toBe(200);
  const cardId = issued.body['id'] as string;
  await grants([
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.branch],
  ]);
  await sameAsMissing(list);
  await sameAsMissing((employee) => issue(employee, 'CARD-NO-1002'));
  await sameAsMissing((employee) => revoke(employee, cardId));
  const [row] = await f.h.owner`SELECT revoked_at::text AS revoked_at,
    (SELECT count(*) FROM employee_cards WHERE company_id=${f.company} AND employee_id=${employeeId}
      AND revoked_at IS NULL) AS active
    FROM employee_cards WHERE company_id=${f.company} AND id=${cardId}`;
  expect(row?.['revoked_at']).toBeNull();
  expect(Number(row?.['active'])).toBe(1);
});

it('branch ALLOW on the employee branch lists, issues and revokes the card', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const listed = await list();
  expect(listed.status).toBe(200);
  expect(listed.body['can_manage']).toBe(true);
  const issued = await issue(employeeId, 'CARD-OK-2002');
  expect(issued.status).toBe(200);
  const revoked = await revoke(employeeId, issued.body['id'] as string);
  expect(revoked.status).toBe(200);
  expect(typeof revoked.body['revoked_at']).toBe('string');
});

function assertCodeHidden(rows: readonly object[], code: string) {
  const suffix = code.length >= 8 ? code.slice(-4) : '';
  const text = JSON.stringify(
    rows.map((row) => {
      const record = row as { before?: unknown; after?: unknown };
      return [record.before ?? null, record.after ?? null];
    }),
  );
  const floor = suffix.length === 0 ? 1 : suffix.length;
  for (let length = floor; length <= code.length; length += 1) {
    for (let start = 0; start + length <= code.length; start += 1) {
      const piece = code.slice(start, start + length);
      if (piece !== suffix) expect(text, piece).not.toContain(piece);
    }
  }
}

async function ordered<T extends { status: number }>(run: () => Promise<T>) {
  const start = f.h.calls.statements.length;
  const response = await run();
  const sqlText = f.h.calls.statements.slice(start).map((statement) => statement.sql);
  const claim = sqlText.findIndex((line) => line.includes('INSERT INTO idempotency_keys'));
  const company = sqlText.findIndex((line) => line.includes('FOR NO KEY UPDATE'));
  const members = sqlText.findIndex(
    (line) => line.includes('FROM memberships') && line.includes('ORDER BY id FOR UPDATE'),
  );
  const audit = sqlText.findIndex((line) => line.includes('INSERT INTO audit_log'));
  const stored = sqlText.findIndex((line) => line.includes('UPDATE idempotency_keys'));
  expect(claim).toBeGreaterThanOrEqual(0);
  expect(company).toBeGreaterThan(claim);
  expect(members).toBeGreaterThan(company);
  expect(audit).toBeGreaterThan(members);
  expect(stored).toBeGreaterThan(audit);
  return response;
}

it('replays an issue after a later branch DENY and rejects another card code', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const key = ids.newId();
  const code = 'WmReplay!9mQx';
  const first = await issueWith(employeeId, code, key);
  expect(first.status).toBe(200);
  expect((await issueWith(employeeId, code, key)).body).toEqual(first.body);
  await grants([['DENY', 'BRANCH', f.branch]]);
  const denied = await issueWith(employeeId, code, key);
  expect(denied.status).toBe(200);
  expect(denied.body).toEqual(first.body);
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const changed = await issueWith(employeeId, 'WmOther!8kLp', key);
  expect(changed.status).toBe(422);
  expect(changed.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  const rows = await auditFor(String(first.body['id']));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['action']).toBe('issued');
  assertCodeHidden(rows, code);
});

it('revokes once, replays that body, and 404s an already-revoked card', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const code = 'WmRevoke!7nRs';
  const issued = await issue(employeeId, code);
  expect(issued.status).toBe(200);
  const cardId = String(issued.body['id']);
  const key = ids.newId();
  const first = await revoke(employeeId, cardId, key);
  expect((await revoke(employeeId, cardId, key)).body).toEqual(first.body);
  const rows = await auditFor(cardId);
  expect(rows.map((row) => row['action'])).toEqual(['issued', 'revoked']);
  assertCodeHidden(rows, code);
  const late = await revoke(employeeId, cardId);
  expect(late.status).toBe(404);
  expect(late.body['code']).toBe('NOT_FOUND');
});

it('reissue revokes the previous active card and writes one revoked audit row', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const firstCode = 'WmFirst!6pQt';
  const secondCode = 'WmSecond!5rUv';
  const first = await issue(employeeId, firstCode);
  const second = await issue(employeeId, secondCode);
  expect(second.status).toBe(200);
  const oldId = String(first.body['id']);
  const [old] = await f.h.owner`SELECT revoked_at IS NOT NULL AS gone FROM employee_cards
    WHERE company_id=${f.company} AND id=${oldId}`;
  expect(old?.['gone']).toBe(true);
  const revoked = await auditFor(oldId);
  expect(revoked.filter((row) => row['action'] === 'revoked')).toHaveLength(1);
  const issued = await auditFor(String(second.body['id']));
  expect(issued.map((row) => row['action'])).toEqual(['issued']);
  assertCodeHidden([...revoked, ...issued], firstCode);
  assertCodeHidden(issued, secondCode);
  const [active] = await f.h.owner`SELECT id FROM employee_cards
    WHERE company_id=${f.company} AND employee_id=${employeeId} AND revoked_at IS NULL`;
  expect(active?.['id']).toBe(second.body['id']);
});

it('returns 409 for a code active on another employee and 404 for that employee card', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const code = 'WmShared!4tWx';
  const issued = await issue(employeeId, code);
  expect(issued.status).toBe(200);
  const conflict = await issue(colleagueId, code);
  expect(conflict.status).toBe(409);
  expect(conflict.body['code']).toBe('EMPLOYEE_CARD_CODE_IN_USE');
  const stolen = await revoke(colleagueId, String(issued.body['id']));
  expect(stolen.status).toBe(404);
  expect(stolen.body['code']).toBe('NOT_FOUND');
  const [active] = await f.h.owner`SELECT count(*)::int AS n FROM employee_cards
    WHERE company_id=${f.company} AND employee_id=${employeeId} AND revoked_at IS NULL`;
  expect(active?.['n']).toBe(1);
});

it('keeps the branch check and the audit inside the idempotent claim', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const issued = await ordered(() => issue(employeeId, 'WmOrder!3vYz'));
  expect(issued.status).toBe(200);
  const revoked = await ordered(() => revoke(employeeId, String(issued.body['id'])));
  expect(revoked.status).toBe(200);
});

it('rejects the same revoke fingerprint when the card id changes', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const issued = await issue(employeeId, 'WmFinger!2wAb');
  expect(issued.status).toBe(200);
  const revokeCard = new RevokeEmployeeCard(
    createEmployeeCards(
      f.db,
      ids,
      { now: () => new Date('2026-10-07T00:00:00.000Z') },
      createEmployeeCardAccess(),
      createEmployeeCardHash(cardKey),
    ),
  );
  const idem = { key: ids.newId(), fingerprint: 'a'.repeat(64) };
  const scope = {
    companyId: f.company,
    businessId: f.business,
    employeeId,
    operatorId: f.userId,
  };
  const body = await revokeCard.execute(scope, String(issued.body['id']), idem);
  expect(body.revokedAt).toBe('2026-10-07T00:00:00.000Z');
  await expect(revokeCard.execute(scope, ids.newId(), idem)).rejects.toThrow(
    IdempotencyKeyReusedError,
  );
});
