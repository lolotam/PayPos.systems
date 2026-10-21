import { alertRules, type SetAlertRulesInput } from '@pospay/contracts';
import type { AlertKind } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { readAlertRule } from '../index.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

type Rule = SetAlertRulesInput['rules'][number];
const notClockedIn = (delay: number, enabled = true): Rule => ({
  kind: 'SHIFT_NOT_CLOCKED_IN',
  enabled,
  recipient_roles: ['owner', 'branch_manager'],
  channels: ['IN_APP'],
  delay_minutes: delay,
  lead_minutes: null,
});
const path = (branch: string | null, business = f.business) =>
  branch === null
    ? `/v1/businesses/${business}/alert-rules`
    : `/v1/businesses/${business}/branches/${branch}/alert-rules`;
const put = (branch: string | null, rules: Rule[], cookie = f.cookie, business = f.business) =>
  f.h.send('PUT', path(branch, business), { cookie, company: f.company, body: { rules } });
const master = (alerts_enabled: boolean, cookie = f.cookie) =>
  f.h.send('PUT', `/v1/businesses/${f.business}/alert-rules/master`, {
    cookie,
    company: f.company,
    body: { alerts_enabled },
  });
const reset = (branch: string, kind: AlertKind, cookie = f.cookie) =>
  f.h.send('DELETE', `${path(branch)}/${kind}`, { cookie, company: f.company });
const effective = (branch: string | null, kind: AlertKind) =>
  f.db.withTenant(f.company, (tx) =>
    readAlertRule(tx, f.company, { businessId: f.business, branchId: branch }, kind),
  );
const audits = () => f.h.owner`SELECT action, before, after FROM audit_log
  WHERE company_id=${f.company} AND entity IN ('alert_rule','alert_rules_master') ORDER BY id`;
const dropOverride = (id: string) =>
  f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;

it('reads the AL-Q5 defaults for every kind before anything is saved', async () => {
  const response = await f.h.send('GET', path(null), { cookie: f.cookie, company: f.company });
  expect(response.status).toBe(200);
  const view = alertRules.parse(response.body);
  expect(view.alerts_enabled).toBe(true);
  expect(view.rules).toHaveLength(14);
  expect(view.rules.find((r) => r.kind === 'SHIFT_NOT_CLOCKED_IN')).toMatchObject({
    source: 'DEFAULT',
    enabled: true,
    delay_minutes: 20,
  });
  expect((await effective(f.branch, 'SHIFT_NOT_CLOCKED_IN')).delayMinutes).toBe(20);
});

it('RT-26b: a branch override wins for its branch only; deleting it returns to the business rule', async () => {
  expect((await put(null, [notClockedIn(20)])).status).toBe(200);
  const saved = await put(f.branch, [notClockedIn(10)]);
  expect(saved.status).toBe(200);
  expect(
    alertRules.parse(saved.body).rules.find((r) => r.kind === 'SHIFT_NOT_CLOCKED_IN'),
  ).toMatchObject({ source: 'BRANCH', delay_minutes: 10 });
  expect(await effective(f.branch, 'SHIFT_NOT_CLOCKED_IN')).toMatchObject({
    source: 'BRANCH',
    delayMinutes: 10,
  });
  expect(await effective(f.siblingBranch, 'SHIFT_NOT_CLOCKED_IN')).toMatchObject({
    source: 'BUSINESS',
    delayMinutes: 20,
  });
  expect(await effective(null, 'DOCUMENT_EXPIRING')).toMatchObject({ source: 'DEFAULT' });
  expect((await reset(f.branch, 'SHIFT_NOT_CLOCKED_IN')).status).toBe(204);
  expect(await effective(f.branch, 'SHIFT_NOT_CLOCKED_IN')).toMatchObject({
    source: 'BUSINESS',
    delayMinutes: 20,
  });
  expect((await reset(f.branch, 'SHIFT_NOT_CLOCKED_IN')).status).toBe(204);
});

it('RT-26: one kind off carries no recipients; the master switch stops every kind and both branches', async () => {
  expect((await put(null, [notClockedIn(20, false)])).status).toBe(200);
  expect(await effective(f.branch, 'SHIFT_NOT_CLOCKED_IN')).toMatchObject({
    enabled: false,
    recipientRoles: [],
    channels: [],
    fixedRecipients: [],
  });
  expect((await effective(f.branch, 'ATTENDANCE_EXCEPTION')).enabled).toBe(true);
  expect((await put(null, [notClockedIn(20)])).status).toBe(200);
  await put(f.branch, [notClockedIn(10)]);
  expect((await master(false)).status).toBe(200);
  for (const branch of [f.branch, f.siblingBranch, null])
    for (const kind of ['SHIFT_NOT_CLOCKED_IN', 'ATTENDANCE_EXCEPTION', 'DOCUMENT_EXPIRING'] as const)
      expect(await effective(branch, kind)).toMatchObject({ enabled: false, recipientRoles: [] });
  expect((await master(true)).status).toBe(200);
  expect((await effective(f.siblingBranch, 'SHIFT_NOT_CLOCKED_IN')).enabled).toBe(true);
});

it('validates per kind with ALERT_RULE_INVALID and saves nothing', async () => {
  const before = (await audits()).length;
  for (const rule of [
    { ...notClockedIn(20), delay_minutes: null },
    { ...notClockedIn(20), kind: 'ATTENDANCE_EXCEPTION' as const },
    {
      kind: 'DOCUMENT_EXPIRING' as const,
      enabled: true,
      recipient_roles: [],
      channels: ['IN_APP' as const],
      delay_minutes: null,
      lead_minutes: 60,
    },
  ]) {
    const response = await put(null, [rule]);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'ALERT_RULE_INVALID' });
  }
  expect((await audits()).length).toBe(before);
});

it('RT-29: audited with before/after; a repeated save writes nothing', async () => {
  const before = (await audits()).length;
  expect((await put(null, [notClockedIn(25)])).status).toBe(200);
  expect((await put(null, [notClockedIn(25)])).status).toBe(200);
  expect((await master(true)).status).toBe(200);
  const rows = await audits();
  expect(rows.length).toBe(before + 1);
  expect(rows.at(-1)).toMatchObject({
    action: 'alert_rule.saved',
    before: { kind: 'SHIFT_NOT_CLOCKED_IN', rule: { delay_minutes: 20 } },
    after: { kind: 'SHIFT_NOT_CLOCKED_IN', branch_id: null, rule: { delay_minutes: 25 } },
  });
});

it('RT-29: no permission, a branch-only grant, a branch DENY and another business are a uniform 403', async () => {
  const forbidden = async (response: { status: number }) => expect(response.status).toBe(403);
  await forbidden(await put(null, [notClockedIn(15)], f.managerCookie));
  await forbidden(await master(false, f.managerCookie));
  const branchGrant = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:settings:business',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  await forbidden(await put(f.branch, [notClockedIn(15)], f.managerCookie));
  await forbidden(await reset(f.branch, 'SHIFT_NOT_CLOCKED_IN', f.managerCookie));
  await dropOverride(branchGrant);
  await seedOverride(f, f.managerMember, { permission_code: 'manage:settings:business' });
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:settings:business',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  await forbidden(await put(f.branch, [notClockedIn(15)], f.managerCookie));
  await forbidden(await reset(f.branch, 'SHIFT_NOT_CLOCKED_IN', f.managerCookie));
  expect((await put(f.siblingBranch, [notClockedIn(15)], f.managerCookie)).status).toBe(200);
  await forbidden(await put(f.foreignBranch, [notClockedIn(15)], f.managerCookie));
  await forbidden(await put(f.foreignBranch, [notClockedIn(15)]));
  await forbidden(
    await f.h.send('GET', path(f.foreignBranch), { cookie: f.cookie, company: f.company }),
  );
  await forbidden(await put(f.branch, [notClockedIn(15)], f.cookie, f.otherBusiness));
  await forbidden(await reset(f.foreignBranch, 'SHIFT_NOT_CLOCKED_IN'));
  expect((await effective(f.branch, 'SHIFT_NOT_CLOCKED_IN')).delayMinutes).toBe(10);
});
