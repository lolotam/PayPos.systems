import { alertRules, type SetAlertRulesInput } from '@pospay/contracts';
import type { AlertKind } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

type Rule = SetAlertRulesInput['rules'][number];
const rule = (
  kind: AlertKind,
  delay: number | null,
  expected_rule_id: string | null,
  expected_revision: number | null,
): Rule => ({
  kind,
  enabled: true,
  recipient_roles: ['owner', 'branch_manager'],
  channels: ['IN_APP'],
  delay_minutes: delay,
  lead_minutes: null,
  expected_rule_id,
  expected_revision,
});
const businessPath = () => `/v1/businesses/${f.business}/alert-rules`;
const branchPath = () => `/v1/businesses/${f.business}/branches/${f.branch}/alert-rules`;
const put = (rules: Rule[]) =>
  f.h.send('PUT', businessPath(), { cookie: f.cookie, company: f.company, body: { rules } });
const putBranch = (rules: Rule[]) =>
  f.h.send('PUT', branchPath(), { cookie: f.cookie, company: f.company, body: { rules } });
const deleteBranch = (kind: AlertKind, ruleId: string, revision: number) =>
  f.h.send(
    'DELETE',
    `${branchPath()}/${kind}?expected_rule_id=${ruleId}&expected_revision=${revision}`,
    { cookie: f.cookie, company: f.company },
  );
const stored = (kind: AlertKind) =>
  f.h.owner`SELECT kind, enabled, delay_minutes, revision FROM alert_rules
    WHERE company_id=${f.company} AND business_id=${f.business} AND branch_id IS NULL
      AND kind=${kind} ORDER BY kind`;
const branchRows = (kind: AlertKind) =>
  f.h.owner`SELECT id, kind, enabled, delay_minutes, revision FROM alert_rules
    WHERE company_id=${f.company} AND business_id=${f.business} AND branch_id=${f.branch}
      AND kind=${kind} ORDER BY kind`;
const audits = () => f.h.owner`SELECT action FROM audit_log
  WHERE company_id=${f.company} AND entity IN ('alert_rule','alert_rules_master') ORDER BY id`;
const revisionOf = (body: Record<string, unknown>, kind: AlertKind) =>
  alertRules.parse(body).rules.find((rule) => rule.kind === kind)?.revision ?? null;
const ruleIdOf = (body: Record<string, unknown>, kind: AlertKind) =>
  alertRules.parse(body).rules.find((rule) => rule.kind === kind)?.rule_id ?? null;

it('a first save sends no stored row and the response carries its id and revision', async () => {
  const response = await put([rule('ATTENDANCE_EXCEPTION', null, null, null)]);
  expect(response.status).toBe(200);
  expect(revisionOf(response.body, 'ATTENDANCE_EXCEPTION')).toBe(1);
  expect(ruleIdOf(response.body, 'ATTENDANCE_EXCEPTION')).not.toBeNull();
  expect(await stored('ATTENDANCE_EXCEPTION')).toMatchObject([{ revision: 1 }]);
});

it('a stale expected_revision is a 409 and changes nothing', async () => {
  const saved = await put([rule('LATE_SERVICE_SESSION', null, null, null)]);
  expect(saved.status).toBe(200);
  const before = await stored('LATE_SERVICE_SESSION');
  const auditsBefore = (await audits()).length;
  const response = await put([
    rule('LATE_SERVICE_SESSION', null, ruleIdOf(saved.body, 'LATE_SERVICE_SESSION'), 99),
  ]);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'ALERT_RULE_REVISION_CONFLICT' });
  expect(await stored('LATE_SERVICE_SESSION')).toEqual(before);
  expect((await audits()).length).toBe(auditsBefore);
});

it('the revision the response returned is the one the next save sends', async () => {
  const first = await put([rule('SHIFT_BREAK_NOT_RETURNED', 20, null, null)]);
  expect(first.status).toBe(200);
  const revision = revisionOf(first.body, 'SHIFT_BREAK_NOT_RETURNED');
  expect(revision).toBe(1);
  const second = await put([
    rule(
      'SHIFT_BREAK_NOT_RETURNED',
      30,
      ruleIdOf(first.body, 'SHIFT_BREAK_NOT_RETURNED'),
      revision,
    ),
  ]);
  expect(second.status).toBe(200);
  expect(revisionOf(second.body, 'SHIFT_BREAK_NOT_RETURNED')).toBe(2);
  expect(await stored('SHIFT_BREAK_NOT_RETURNED')).toMatchObject([{ revision: 2 }]);
});

it('the master switch response shows the value just written', async () => {
  const response = await f.h.send('PUT', `/v1/businesses/${f.business}/alert-rules/master`, {
    cookie: f.cookie,
    company: f.company,
    body: { alerts_enabled: false },
  });
  expect(response.status).toBe(200);
  expect(alertRules.parse(response.body).alerts_enabled).toBe(false);
  const [row] = await f.h.owner`SELECT alerts_enabled FROM business_settings
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(row?.['alerts_enabled']).toBe(false);
});

it('a branch override is read with its row id, and a matching DELETE removes it', async () => {
  const saved = await putBranch([rule('SHIFT_NOT_CLOCKED_IN', 20, null, null)]);
  expect(saved.status).toBe(200);
  const ruleId = ruleIdOf(saved.body, 'SHIFT_NOT_CLOCKED_IN');
  const revision = revisionOf(saved.body, 'SHIFT_NOT_CLOCKED_IN');
  expect(ruleId).not.toBeNull();
  expect(revision).toBe(1);
  const removed = await deleteBranch('SHIFT_NOT_CLOCKED_IN', ruleId ?? '', revision ?? 1);
  expect(removed.status).toBe(204);
  expect(await branchRows('SHIFT_NOT_CLOCKED_IN')).toEqual([]);
});

it('a stale DELETE is a 409 and changes nothing', async () => {
  const saved = await putBranch([rule('SHIFT_BREAK_NOT_RETURNED', 10, null, null)]);
  const ruleId = ruleIdOf(saved.body, 'SHIFT_BREAK_NOT_RETURNED');
  const revision = revisionOf(saved.body, 'SHIFT_BREAK_NOT_RETURNED');
  const updated = await putBranch([rule('SHIFT_BREAK_NOT_RETURNED', 20, ruleId, revision)]);
  expect(updated.status).toBe(200);
  const before = await branchRows('SHIFT_BREAK_NOT_RETURNED');
  const auditsBefore = (await audits()).length;
  const stale = await deleteBranch('SHIFT_BREAK_NOT_RETURNED', ruleId ?? '', revision ?? 1);
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'ALERT_RULE_REVISION_CONFLICT' });
  expect(await branchRows('SHIFT_BREAK_NOT_RETURNED')).toEqual(before);
  expect((await audits()).length).toBe(auditsBefore);
});

it('a reset and a new save give the branch a new row, so the old row no longer matches', async () => {
  const saved = await putBranch([rule('LATE_SERVICE_SESSION', null, null, null)]);
  const ruleId = ruleIdOf(saved.body, 'LATE_SERVICE_SESSION');
  const revision = revisionOf(saved.body, 'LATE_SERVICE_SESSION');
  expect((await deleteBranch('LATE_SERVICE_SESSION', ruleId ?? '', revision ?? 1)).status).toBe(
    204,
  );
  const recreated = await putBranch([rule('LATE_SERVICE_SESSION', null, null, null)]);
  expect(recreated.status).toBe(200);
  expect(revisionOf(recreated.body, 'LATE_SERVICE_SESSION')).toBe(1);
  expect(ruleIdOf(recreated.body, 'LATE_SERVICE_SESSION')).not.toBe(ruleId);
  const before = await branchRows('LATE_SERVICE_SESSION');
  const stale = await putBranch([rule('LATE_SERVICE_SESSION', null, ruleId, revision)]);
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'ALERT_RULE_REVISION_CONFLICT' });
  expect(await branchRows('LATE_SERVICE_SESSION')).toEqual(before);
});

it('a DELETE without the query values is a 400', async () => {
  const response = await f.h.send('DELETE', `${branchPath()}/SHIFT_ENDS_SOON`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
});
