import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  auditRows,
  clearRules,
  documentExpiryLedger,
  eventBell,
  eventRecipients,
  outboxRows,
  saveRule,
  setMaster,
  type RuleContext,
} from './alert-rule.helpers.ts';
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

/** مالك النشاط: هو صاحب صلاحية read:files:business الافتراضية. */
async function owner(tenant: Tenant) {
  const userId = await f.user('owner');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  return userId;
}

async function setup(tenant: Tenant, expiresOn = '2026-11-04') {
  const employee = await f.employee(tenant);
  await f.type(tenant, 'passport', 30);
  const document = await f.document(tenant, employee, 'passport', expiresOn);
  return { employee, document };
}

const BELL_PARAMETERS = [
  { name: 'employee_name_ar', type: 'text', value: 'Synthetic expiry employee' },
  { name: 'employee_name_en', type: 'text', value: 'Synthetic expiry employee' },
  { name: 'document_type_ar', type: 'text', value: 'passport' },
  { name: 'document_type_en', type: 'text', value: 'passport' },
  { name: 'expires_on', type: 'text', value: '2026-11-04' },
];

it('the default rule reaches the owner and attaches the recipients once', async () => {
  const tenant = await f.tenant();
  const ownerId = await owner(tenant);
  const { document } = await setup(tenant);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([ownerId]);
  const bell = eventBell(events[0]);
  expect(bell?.template_key).toBe('document_expiring');
  expect(bell?.template_revision).toBe(1);
  expect(bell?.safe_parameters).toEqual([
    ...BELL_PARAMETERS,
    { name: 'document_id', type: 'text', value: document },
  ]);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger).toHaveLength(1);
  expect(new Date(ledger[0]?.['recipients_attached_at'] as string).toISOString()).toBe(
    f.clock.now().toISOString(),
  );
  const audit = await auditRows(ctx, tenant.company);
  expect(audit.map((row) => row['action'])).toEqual([
    'document_expiring.notified',
    'document_expiring.recipients_attached',
  ]);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

it('a switched off kind keeps the ledger row and sends no bell, and a later run attaches them', async () => {
  const tenant = await f.tenant();
  const ownerId = await owner(tenant);
  await setup(tenant);
  await saveRule(ctx, tenant, KIND, { enabled: false, roles: [] });

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger).toHaveLength(1);
  expect(ledger[0]?.['recipients_attached_at']).toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect((await auditRows(ctx, tenant.company)).map((row) => row['action'])).toEqual([
    'document_expiring.notified',
  ]);

  await clearRules(ctx, tenant, KIND);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([ownerId]);
  const attached = await documentExpiryLedger(ctx, tenant.company);
  expect(new Date(attached[0]?.['recipients_attached_at'] as string).toISOString()).toBe(
    f.clock.now().toISOString(),
  );

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

it('the master switch off emits nothing and leaves the marker empty', async () => {
  const tenant = await f.tenant();
  await owner(tenant);
  await setup(tenant);
  await setMaster(ctx, tenant, false);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger).toHaveLength(1);
  expect(ledger[0]?.['recipients_attached_at']).toBeNull();
});

it('a notice left by the earlier job gets its recipients once', async () => {
  const tenant = await f.tenant();
  const ownerId = await owner(tenant);
  const { employee, document } = await setup(tenant);
  await f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${tenant.company},${f.ids.newId()},${document},${employee},${tenant.business},'passport','2026-11-04',now())`;

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([ownerId]);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger[0]?.['recipients_attached_at']).not.toBeNull();

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

it('a replaced document keeps its marker empty and sends no bell', async () => {
  const tenant = await f.tenant();
  await owner(tenant);
  const { employee, document } = await setup(tenant);
  await f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${tenant.company},${f.ids.newId()},${document},${employee},${tenant.business},'passport','2026-11-04',now())`;
  await f.owner`UPDATE employee_documents SET replaced_at=clock_timestamp()
    WHERE company_id=${tenant.company} AND id=${document}`;

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger[0]?.['recipients_attached_at']).toBeNull();
});

it('a document that left its window keeps its marker empty and sends no bell', async () => {
  const tenant = await f.tenant();
  await owner(tenant);
  const { employee, document } = await setup(tenant);
  await f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${tenant.company},${f.ids.newId()},${document},${employee},${tenant.business},'passport','2026-11-04',now())`;
  await f.setAlertDays(tenant, 'passport', 1);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger[0]?.['recipients_attached_at']).toBeNull();
});

it('a soft deleted employee keeps its marker empty and sends no bell', async () => {
  const tenant = await f.tenant();
  await owner(tenant);
  const { employee, document } = await setup(tenant);
  await f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${tenant.company},${f.ids.newId()},${document},${employee},${tenant.business},'passport','2026-11-04',now())`;
  await f.owner`UPDATE employees SET deleted_at=clock_timestamp()
    WHERE company_id=${tenant.company} AND id=${employee}`;

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger[0]?.['recipients_attached_at']).toBeNull();
});

it('an inactive document type keeps its marker empty and sends no bell', async () => {
  const tenant = await f.tenant();
  await owner(tenant);
  const { employee, document } = await setup(tenant);
  await f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${tenant.company},${f.ids.newId()},${document},${employee},${tenant.business},'passport','2026-11-04',now())`;
  await f.owner`UPDATE document_types SET active=false
    WHERE company_id=${tenant.company} AND code='passport'`;

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const ledger = await documentExpiryLedger(ctx, tenant.company);
  expect(ledger[0]?.['recipients_attached_at']).toBeNull();
});
