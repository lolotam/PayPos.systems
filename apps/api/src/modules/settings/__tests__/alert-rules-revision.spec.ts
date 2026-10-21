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
const rule = (kind: AlertKind, delay: number | null, expected_revision: number | null): Rule => ({
  kind,
  enabled: true,
  recipient_roles: ['owner', 'branch_manager'],
  channels: ['IN_APP'],
  delay_minutes: delay,
  lead_minutes: null,
  expected_revision,
});
const put = (rules: Rule[]) =>
  f.h.send('PUT', `/v1/businesses/${f.business}/alert-rules`, {
    cookie: f.cookie,
    company: f.company,
    body: { rules },
  });
const stored = (kind: AlertKind) =>
  f.h.owner`SELECT kind, enabled, delay_minutes, revision FROM alert_rules
    WHERE company_id=${f.company} AND business_id=${f.business} AND branch_id IS NULL
      AND kind=${kind} ORDER BY kind`;
const audits = () => f.h.owner`SELECT action FROM audit_log
  WHERE company_id=${f.company} AND entity IN ('alert_rule','alert_rules_master') ORDER BY id`;
const revisionOf = (body: Record<string, unknown>, kind: AlertKind) =>
  alertRules.parse(body).rules.find((rule) => rule.kind === kind)?.revision ?? null;

it('a first save sends a null expected_revision and the response carries the new revision', async () => {
  const response = await put([rule('ATTENDANCE_EXCEPTION', null, null)]);
  expect(response.status).toBe(200);
  expect(revisionOf(response.body, 'ATTENDANCE_EXCEPTION')).toBe(1);
  expect(await stored('ATTENDANCE_EXCEPTION')).toMatchObject([{ revision: 1 }]);
});

it('a stale expected_revision is a 409 and changes nothing', async () => {
  expect((await put([rule('LATE_SERVICE_SESSION', null, null)])).status).toBe(200);
  const before = await stored('LATE_SERVICE_SESSION');
  const auditsBefore = (await audits()).length;
  const response = await put([rule('LATE_SERVICE_SESSION', null, 99)]);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'ALERT_RULE_REVISION_CONFLICT' });
  expect(await stored('LATE_SERVICE_SESSION')).toEqual(before);
  expect((await audits()).length).toBe(auditsBefore);
});

it('the revision the response returned is the one the next save sends', async () => {
  const first = await put([rule('SHIFT_BREAK_NOT_RETURNED', 20, null)]);
  expect(first.status).toBe(200);
  const revision = revisionOf(first.body, 'SHIFT_BREAK_NOT_RETURNED');
  expect(revision).toBe(1);
  const second = await put([rule('SHIFT_BREAK_NOT_RETURNED', 30, revision)]);
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
