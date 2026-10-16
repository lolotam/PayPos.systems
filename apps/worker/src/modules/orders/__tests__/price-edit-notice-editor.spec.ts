import type { Tx } from '@pospay/db';
import { t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { PriceEditNameFallback } from '../domain/price-edit-notice.ts';
import { onServiceLineChanged } from '../events/handlers/on-service-line-changed.handler.ts';
import { priceEditPlace } from '../persistence/price-edit-place.adapter.ts';
import { priceEditRecipients } from '../persistence/price-edit-recipients.adapter.ts';
import {
  priceEditOutbox,
  priceEditRepository,
} from '../persistence/service-line-edit-notice.repository.ts';
import { RequestPriceEditNotice } from '../use-cases/request-price-edit-notice/request-price-edit-notice.ts';
import { priceEditFixture, type PriceEditFixture } from './price-edit-notice.fixture.ts';

let f: PriceEditFixture;
beforeAll(async () => {
  f = await priceEditFixture();
});
afterAll(async () => {
  await f?.close();
});

it('test 6: no manager still records a ledger row with count 0 and sets the consumed mark', async () => {
  const prepared = await f.edit();
  expect(await withoutManagers()(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(1);
});

it('test 6: the editor is notified when they are the only eligible person, and only once among other managers', async () => {
  const alone = await f.edit();
  await f.deliver(alone.event);
  expect(recipientIds(await f.requests(alone.sessionId))).toEqual([USER]);
  const colleague = await f.user();
  await f.member(colleague, 'branch_manager', 'BRANCH', f.tenant.branch);
  await f.member(USER, 'branch_manager', 'BRANCH', f.tenant.branch);
  const shared = await f.edit();
  await f.deliver(shared.event);
  expect(recipientIds(await f.requests(shared.sessionId))).toEqual([USER, colleague].sort());
});

it('test 6: a nameless owner or manager editor keeps the fixed role label from the history row', async () => {
  const owner = await f.edit({ editorNameAr: null, editorNameEn: null, editorRole: 'owner' });
  const manager = await f.edit({ editorNameAr: null, editorNameEn: null, editorRole: 'manager' });
  await f.deliver(owner.event);
  await f.deliver(manager.event);
  expect(parameter(await f.requests(owner.sessionId), 'editor_name_ar')).toBe('المالك');
  expect(parameter(await f.requests(owner.sessionId), 'editor_name_en')).toBe('Owner');
  expect(parameter(await f.requests(manager.sessionId), 'editor_name_ar')).toBe('المدير');
  expect(parameter(await f.requests(manager.sessionId), 'editor_name_en')).toBe('Manager');
});

it('test 6: relinking the employee after the history row does not change the stored editor name', async () => {
  const prepared = await f.edit({
    editorNameAr: 'شخص اللقطة',
    editorNameEn: 'Snapshot Person',
    editorRole: 'manager',
  });
  await f.owner`UPDATE employees SET user_id=${USER}, name_en='Relinked Person', name_en_key='relinked person', deleted_at=${f.at}
    WHERE company_id=${TENANT.A.company} AND id=${ORDER_IDS.employee}`;
  await f.deliver(prepared.event);
  expect(parameter(await f.requests(prepared.sessionId), 'editor_name_ar')).toBe('شخص اللقطة');
  expect(parameter(await f.requests(prepared.sessionId), 'editor_name_en')).toBe('Snapshot Person');
});

it('test 6: unsafe service and branch names fall back to the catalog labels', async () => {
  const prepared = await f.edit();
  await f.owner`UPDATE service_lines SET name_en='https://example.test', name_ar=NULL WHERE company_id=${prepared.companyId} AND id=${prepared.lineId}`;
  await f.owner`UPDATE branches SET name_en='https://example.test', name_ar='12345678' WHERE company_id=${prepared.companyId} AND id=${prepared.branchId}`;
  try {
    await f.deliver(prepared.event);
    const requests = await f.requests(prepared.sessionId);
    expect(parameter(requests, 'service_name_ar')).toBe('الخدمة');
    expect(parameter(requests, 'service_name_en')).toBe('Service');
    expect(parameter(requests, 'branch_name_ar')).toBe('فرع');
    expect(parameter(requests, 'branch_name_en')).toBe('Branch');
  } finally {
    await f.owner`UPDATE branches SET name_en='Branch A', name_ar=NULL WHERE company_id=${prepared.companyId} AND id=${prepared.branchId}`;
  }
});

it('test 6: an editor row with no usable label is invalid even when nobody would be notified', async () => {
  const prepared = await f.edit({ editorNameAr: null, editorNameEn: null, editorRole: null });
  expect((await withoutManagers()(prepared.event)).delivered).toBe(false);
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
});

it('test 6: a stored editor name rejected as unsafe uses the generic employee label when there is no role', async () => {
  const prepared = await f.edit({
    editorNameAr: null,
    editorNameEn: 'https://example.test',
    editorRole: null,
  });
  await f.deliver(prepared.event);
  expect(parameter(await f.requests(prepared.sessionId), 'editor_name_ar')).toBe('موظف');
  expect(parameter(await f.requests(prepared.sessionId), 'editor_name_en')).toBe('Employee');
});

function withoutManagers() {
  return createDeliverer(
    f.db,
    [{ ...f.consumer, handle: (tx, event) => onServiceLineChanged(useCase(tx, async () => []), event) }],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
}
function useCase(tx: Tx, recipients: () => Promise<readonly string[]>) {
  return new RequestPriceEditNotice(
    {
      recipients: { ...priceEditRecipients(tx), branchManagerRecipients: recipients },
      place: priceEditPlace(tx),
      repository: priceEditRepository(tx),
      outbox: priceEditOutbox(tx),
    },
    f.ids,
    { now: () => f.at },
    catalogFallback(),
  );
}
function catalogFallback(): PriceEditNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    owner: { ar: t('ar', 'inApp.editor_role_owner'), en: t('en', 'inApp.editor_role_owner') },
    manager: { ar: t('ar', 'inApp.editor_role_manager'), en: t('en', 'inApp.editor_role_manager') },
    employee: { ar: t('ar', 'inApp.generic_employee'), en: t('en', 'inApp.generic_employee') },
  };
}
function recipientIds(rows: Record<string, unknown>[]): string[] {
  return rows.flatMap((row) =>
    (
      row['payload'] as { notification_recipients: { user_id: string }[] }
    ).notification_recipients.map((recipient) => recipient.user_id),
  );
}
function parameter(rows: Record<string, unknown>[], name: string): string {
  const payload = rows[0]?.['payload'] as {
    notification_recipients: { safe_parameters: { name: string; value: string }[] }[];
  };
  const found = payload.notification_recipients[0]?.safe_parameters.find((item) => item.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found.value;
}
