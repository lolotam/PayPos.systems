import { expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { ServiceImportCommitTransactions } from '../ports/service-import-commit.port.ts';
import { serviceImportCommitTransactions } from '../persistence/service-import-commit.transactions.ts';
import { CommitServiceImport } from '../use-cases/commit-service-import/commit-service-import.ts';
import {
  normalizedRow,
  serviceImportCommitFixture,
  type ServiceImportCommitFixture,
} from './service-import-commit.fixture.ts';

// التثبيت مرة واحدة: صف خدمة وتدقيق إنشاء يدوي لكل صف، وإعادة التسليم بعد النجاح بلا إدخال ثانٍ (FR-009).

it('commits the whole preview once with revision-1 services and manual-create audits', async () => {
  const f = await serviceImportCommitFixture();
  try {
    const categoryId = await f.category('Hair');
    const previewId = await f.requested([
      normalizedRow('Hair Cut', { categoryId }),
      normalizedRow('Nails', { row: 3, price: '5.000' }),
    ]);
    await f.worker.execute(f.company, previewId);
    const [service] = await f
      .owner`SELECT id,name_en,price,commission_rule_kind,revision,category_id,created_at,updated_at
        FROM services WHERE company_id=${f.company} AND name_en='Hair Cut'`;
    expect(service).toMatchObject({
      name_en: 'Hair Cut',
      price: '12.500',
      commission_rule_kind: 'FOLLOW_PLAN',
      revision: 1,
      category_id: categoryId,
    });
    expect(service?.['created_at']).toEqual(service?.['updated_at']);
    expect(await f.serviceCount()).toBe(2);
    const [audit] = await f
      .owner`SELECT action,actor_user_id,before,after FROM audit_log WHERE company_id=${f.company} AND entity='service' AND entity_id=${service?.['id']}`;
    expect(audit).toMatchObject({ action: 'created', actor_user_id: f.userId, before: null });
    expect(audit?.['after']).toMatchObject({
      name_en: 'Hair Cut',
      price: '12.500',
      revision: 1,
      commission_rule: { kind: 'FOLLOW_PLAN' },
    });
    expect(await f.previewRow(previewId)).toMatchObject({
      status: 'committed',
      created_count: 2,
      error_code: null,
    });
    await f.worker.execute(f.company, previewId);
    expect(await f.serviceCount()).toBe(2);
    expect(await f.previewRow(previewId)).toMatchObject({ status: 'committed', created_count: 2 });
  } finally {
    await f.close();
  }
});

it.each([
  [
    'a stored name conflicts the whole preview',
    'IMPORT_SERVICE_EXISTS',
    async (f: ServiceImportCommitFixture) => {
      await f.service('Existing');
      return f.requested([normalizedRow('existing  spa'), normalizedRow('Existing')]);
    },
  ],
  [
    'a stored name with internal whitespace runs conflicts the import',
    'IMPORT_SERVICE_EXISTS',
    async (f: ServiceImportCommitFixture) => {
      // الإنهاء اليدوي يخزّن المسافة المزدوجة كما هي؛ القراءة الحاسمة المطبَّعة تمنع الاستيراد (P1).
      await f.service('Hair  Cut');
      return f.requested([normalizedRow('Hair Cut')]);
    },
  ],
  [
    'a category closed after acceptance fails the preview',
    'IMPORT_CATEGORY_NOT_FOUND',
    async (f: ServiceImportCommitFixture) => {
      const categoryId = await f.category('Closed Cat', true);
      return f.requested([normalizedRow('Service', { categoryId })]);
    },
  ],
  [
    'a category missing from the business fails the preview',
    'IMPORT_CATEGORY_NOT_FOUND',
    async (f: ServiceImportCommitFixture) => {
      return f.requested([
        normalizedRow('Service', { categoryId: '01920000-0000-7000-8000-0000000000ff' }),
      ]);
    },
  ],
] as const)('%s with a stable failed code', async (_name, code, seed) => {
  const f = await serviceImportCommitFixture();
  try {
    const previewId = await seed(f);
    const before = await f.serviceCount();
    await f.worker.execute(f.company, previewId);
    expect(await f.previewRow(previewId)).toMatchObject({ status: 'failed', error_code: code });
    expect(await f.serviceCount()).toBe(before);
  } finally {
    await f.close();
  }
});

it('expires by stored requested_at equality and fails errors-bearing previews', async () => {
  const f = await serviceImportCommitFixture();
  try {
    // المساواة نفسها انتهاء (FR-009): requested_at == expires_at بعد الإنشاء وقبل الانتهاء.
    const boundary = new Date('2026-11-22T13:00:00Z');
    const expired = await f.requested([normalizedRow('Late')], {
      requestedAt: boundary,
      expiresAt: boundary,
      createdAt: new Date('2026-11-22T12:00:00Z'),
    });
    await f.worker.execute(f.company, expired);
    expect(await f.previewRow(expired)).toMatchObject({
      status: 'failed',
      error_code: 'IMPORT_PREVIEW_EXPIRED',
    });
    const withErrors = await f.requested([normalizedRow('Broken')], {
      errors: [{ row: 2, column: 'price', code: 'IMPORT_PRICE_INVALID' }],
    });
    await f.worker.execute(f.company, withErrors);
    expect(await f.previewRow(withErrors)).toMatchObject({
      status: 'failed',
      error_code: 'IMPORT_PREVIEW_HAS_ERRORS',
    });
    expect(await f.serviceCount()).toBe(0);
  } finally {
    await f.close();
  }
});

it('rolls the whole transaction back on an injected mid-write failure and stays requested', async () => {
  const f = await serviceImportCommitFixture();
  try {
    // سعر يكسر cast numeric أثناء الإدخال: فشل غير متوقع يتراجع بالكامل ويبقي الطلب حياً لمحاولاته (FR-009).
    const broken = await f.requested([
      normalizedRow('Crash'),
      { ...normalizedRow('Crash Two', { row: 3 }), price: 'not-a-price' },
    ]);
    await expect(f.worker.execute(f.company, broken)).rejects.toBeTruthy();
    expect(await f.previewRow(broken)).toMatchObject({ status: 'commit_requested', error_code: null });
    expect(await f.serviceCount()).toBe(0);
    const [audits] =
      await f.owner`SELECT count(*) AS count FROM audit_log WHERE company_id=${f.company} AND entity='service'`;
    expect(Number(audits?.['count'])).toBe(0);
  } finally {
    await f.close();
  }
});

it('rolls back services and audits when completion fails after the writes succeeded', async () => {
  // كسر الإتمام بعد نجاح الإدخال والتدقيق يُظهر التراجع الحقيقي للمعاملة الواحدة (P2 مراجعة 32b-2):
  // الصفوف والتدقيق كُتبا داخل المعاملة ثم رجعوا، والمعاينة بقيت commit_requested لمحاولات FR-009.
  const f = await serviceImportCommitFixture();
  try {
    const categoryId = await f.category('Hair');
    const previewId = await f.requested([
      normalizedRow('Rollback One', { categoryId }),
      normalizedRow('Rollback Two', { row: 3 }),
    ]);
    const before = await f.serviceCount();
    const [auditsBefore] =
      await f.owner`SELECT count(*) AS count FROM audit_log WHERE company_id=${f.company} AND entity='service'`;
    const real = serviceImportCommitTransactions(f.db, f.ids);
    const failing: ServiceImportCommitTransactions = {
      run: (companyId, id, work) =>
        real.run(companyId, id, async (scope) =>
          work({
            ...scope,
            complete: async () => {
              throw new Error('Injected completion failure');
            },
          }),
        ),
      fail: (companyId, id, code) => real.fail(companyId, id, code),
    };
    await expect(
      new CommitServiceImport(failing, f.ids, { now: () => f.clock.value }).execute(
        f.company,
        previewId,
      ),
    ).rejects.toThrow('Injected completion failure');
    expect(await f.serviceCount()).toBe(before);
    const [audits] =
      await f.owner`SELECT count(*) AS count FROM audit_log WHERE company_id=${f.company} AND entity='service'`;
    expect(Number(audits?.['count'])).toBe(Number(auditsBefore?.['count']));
    expect(await f.previewRow(previewId)).toMatchObject({ status: 'commit_requested', error_code: null });
  } finally {
    await f.close();
  }
});

it('fails a missing business through the business-read seam as a terminal commit failure', async () => {
  // الفهرس import_previews_business_fk يمنع حذف نشاط ما يزال مُحالاً، فالغياب يُمارَس على seam القراءة.
  const f = await serviceImportCommitFixture();
  const failures: { companyId: string; previewId: string; code: string }[] = [];
  try {
    const fake: ServiceImportCommitTransactions = {
      run: async (_companyId, _previewId, work) =>
        work({
          preview: {
            id: '00000000-0000-7000-8000-000000000001',
            business_id: '01920000-0000-7000-8000-0000000000e1',
            created_by: USER,
            requested_at: '2026-11-22T12:00:00Z',
            expires_at: '2026-11-23T12:00:00Z',
            error_count: 0,
            rows: [normalizedRow('Ghost Business')],
          },
          lockImport: async () => undefined,
          businessExists: async () => false,
          existingNameKeys: async () => {
            throw new Error('decisive name read must not run after a missing business');
          },
          lockCategories: async () => new Map(),
          insert: async () => undefined,
          complete: async () => undefined,
        }),
      fail: async (companyId, previewId, code) => {
        failures.push({ companyId, previewId, code });
      },
    };
    const ghostWorker = new CommitServiceImport(fake, f.ids, { now: () => f.clock.value });
    await ghostWorker.execute(f.company, '00000000-0000-7000-8000-000000000001');
    expect(failures).toEqual([
      { companyId: f.company, previewId: '00000000-0000-7000-8000-000000000001', code: 'IMPORT_COMMIT_FAILED' },
    ]);
  } finally {
    await f.close();
  }
});

it('serializes two racing commits of one business so exactly one set of services lands', async () => {
  const f = await serviceImportCommitFixture();
  try {
    const first = await f.requested([normalizedRow('Race One'), normalizedRow('Shared', { row: 3 })]);
    const second = await f.requested([normalizedRow('Race Two'), normalizedRow('Shared', { row: 3 })]);
    await Promise.all([f.worker.execute(f.company, first), f.worker.execute(f.company, second)]);
    const winner = await f.previewRow(first);
    const loser = await f.previewRow(second);
    const winners = [winner, loser].filter((row) => row?.['status'] === 'committed');
    expect(winners).toHaveLength(1);
    const failed = [winner, loser].find((row) => row?.['status'] === 'failed');
    expect(failed).toMatchObject({ error_code: 'IMPORT_SERVICE_EXISTS', created_count: 0 });
    expect(await f.serviceCount()).toBe(2);
    const [shared] = await f
      .owner`SELECT count(*) AS count FROM services WHERE company_id=${f.company} AND name_en='Shared'`;
    expect(Number(shared?.['count'])).toBe(1);
  } finally {
    await f.close();
  }
});

it('ignores a foreign-tenant event envelope and a foreign-entity preview', async () => {
  const f = await serviceImportCommitFixture();
  try {
    const foreign = await f.requested([normalizedRow('Foreign Tenant')], {
      companyId: f.otherCompany,
      businessId: f.otherBusiness,
    });
    await f.worker.execute(f.company, foreign);
    const [foreignRow] =
      await f.owner`SELECT status FROM import_previews WHERE company_id=${f.otherCompany} AND id=${foreign}`;
    expect(foreignRow?.['status']).toBe('commit_requested');
    const employeePreview = await f.requested([normalizedRow('Employee Entity')]);
    await f.owner`UPDATE import_previews SET entity='employees' WHERE company_id=${f.company} AND id=${employeePreview}`;
    await f.worker.execute(f.company, employeePreview);
    expect(await f.previewRow(employeePreview)).toMatchObject({ status: 'commit_requested' });
    expect(await f.serviceCount()).toBe(0);
  } finally {
    await f.close();
  }
});
