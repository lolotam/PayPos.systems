import { afterAll, beforeAll, expect, it } from 'vitest';
import { eventRecipients, outboxRows, saveRule, type RuleContext } from './alert-rule.helpers.ts';
import {
  ROLE,
  documentExpiryFixture,
  type DocumentExpiryFixture,
  type Tenant,
} from './document-expiry.fixture.ts';

const KIND = 'DOCUMENT_EXPIRING';
const EVENT = 'DocumentExpiring';

let f: DocumentExpiryFixture;
let ctx: RuleContext;
beforeAll(async () => {
  f = await documentExpiryFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
});
afterAll(async () => {
  await f?.close();
});

/** مالك النشاط: صاحب صلاحية read:files:business الافتراضية. */
async function owner(tenant: Tenant, endsAt: string | null = null) {
  const userId = await f.user('owner');
  const membershipId = await f.member({
    tenant,
    userId,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
    endsAt,
  });
  return { userId, membershipId };
}

/** موظفة بوثيقة في نافذة التنبيه. */
async function setup(tenant: Tenant) {
  const employee = await f.employee(tenant);
  await f.type(tenant, 'passport', 30);
  const document = await f.document(tenant, employee, 'passport', '2026-11-04');
  return { employee, document };
}

/** منحة شخصية على عضوية: صلاحية أو رفض على النشاط. */
async function grant(
  tenant: Tenant,
  membershipId: string,
  effect: 'ALLOW' | 'DENY',
  grantedBy: string,
) {
  await f.override({
    tenant,
    membershipId,
    permissionCode: 'read:files:business',
    effect,
    scopeType: 'BUSINESS',
    scopeId: tenant.business,
    grantedBy,
  });
}

it('a role picks the branch managers and the permission filters them', async () => {
  const tenant = await f.tenant();
  const { userId: ownerId } = await owner(tenant);
  const otherBranch = await f.branch(tenant);
  const allowed = await f.user('branch-manager');
  const withoutPermission = await f.user('plain-manager');
  const elsewhere = await f.user('other-branch-manager');
  const allowedMembership = await f.member({
    tenant,
    userId: allowed,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  await f.member({
    tenant,
    userId: withoutPermission,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const elsewhereMembership = await f.member({
    tenant,
    userId: elsewhere,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: otherBranch,
  });
  await grant(tenant, allowedMembership, 'ALLOW', ownerId);
  await grant(tenant, elsewhereMembership, 'ALLOW', ownerId);
  await setup(tenant);
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: ['branch_manager'] });

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([allowed]);
});

it('a business manager refused by a deny does not get the bell', async () => {
  const tenant = await f.tenant();
  const { userId: ownerId } = await owner(tenant);
  const manager = await f.user('business-manager');
  const membershipId = await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.business_manager,
    scopeType: 'BUSINESS',
    scopeId: tenant.business,
  });
  await grant(tenant, membershipId, 'ALLOW', ownerId);
  await grant(tenant, membershipId, 'DENY', ownerId);
  await setup(tenant);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([ownerId]);
});

it('the owner keeps the bell even with a deny on the permission', async () => {
  const tenant = await f.tenant();
  const { userId: ownerId, membershipId } = await owner(tenant);
  await grant(tenant, membershipId, 'DENY', ownerId);
  await setup(tenant);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([ownerId]);
});

it('a membership that ended before the run gets no bell', async () => {
  const tenant = await f.tenant();
  await owner(tenant, '2026-10-01T00:00:00Z');
  await setup(tenant);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});
