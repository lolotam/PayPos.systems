import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ServiceImportError } from '../domain/errors.ts';
import { serviceImportCommitPreviewStatement } from '../persistence/drizzle-service-import-commit.ts';
import { serviceImportFixture, type ServiceImportFixture } from './service-import.fixture.ts';

// القبول معاملة واحدة: قفل المعاينة، ومطالبة المفتاح، وتحديث الحالة، والحدث، وردّه المخزّن (FR-008).

const fingerprint = 'a'.repeat(64);

function command(f: ServiceImportFixture, previewId: string, key = 'commit-key') {
  return {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    previewId,
    key,
    fingerprint,
  };
}

it('accepts a clean preview once and writes exactly one commit event', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({});
    expect(await f.commit.execute(command(f, previewId))).toEqual({ preview_id: previewId });
    expect(await f.outboxCount(previewId)).toBe(1);
    const [row] =
      await f.h.owner`SELECT status,requested_at FROM import_previews WHERE company_id=${f.company} AND id=${previewId}`;
    expect(row?.['status']).toBe('commit_requested');
    expect(row?.['requested_at']).toBeInstanceOf(Date);
  } finally {
    await f.close();
  }
});

it('concurrent double commit yields one event and two accepted answers (SIT-05)', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({});
    const [first, second] = await Promise.all([
      f.commit.execute(command(f, previewId)),
      f.commit.execute(command(f, previewId)),
    ]);
    expect(first).toEqual({ preview_id: previewId });
    expect(second).toEqual({ preview_id: previewId });
    expect(await f.outboxCount(previewId)).toBe(1);
  } finally {
    await f.close();
  }
});

it('a different key on the same preview repeats the acceptance without a second event (SIT-09)', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({});
    expect(await f.commit.execute(command(f, previewId, 'key-one'))).toEqual({
      preview_id: previewId,
    });
    expect(await f.commit.execute(command(f, previewId, 'key-two'))).toEqual({
      preview_id: previewId,
    });
    expect(await f.outboxCount(previewId)).toBe(1);
  } finally {
    await f.close();
  }
});

it('the same key with a different request is refused as a reused key', async () => {
  const f = await serviceImportFixture();
  try {
    const first = await f.commitPreview({});
    const second = await f.commitPreview({});
    await f.commit.execute(command(f, first, 'shared-key'));
    await expect(
      f.commit.execute({ ...command(f, second, 'shared-key'), fingerprint: 'b'.repeat(64) }),
    ).rejects.toThrow('Idempotency-Key was already used with a different request');
  } finally {
    await f.close();
  }
});

it('refuses an expired preview at the exact expiry instant (SIT-06)', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({ expiresAt: '2026-11-22T10:00:00Z' });
    await expect(f.commit.execute(command(f, previewId))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_EXPIRED',
    });
    expect(await f.outboxCount(previewId)).toBe(0);
  } finally {
    await f.close();
  }
});

it('refuses a preview carrying row errors (SIT-06)', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({
      errorCount: 1,
      errors: [{ row: 2, column: 'price', code: 'IMPORT_PRICE_INVALID' }],
    });
    await expect(f.commit.execute(command(f, previewId))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_HAS_ERRORS',
    });
    expect(await f.outboxCount(previewId)).toBe(0);
  } finally {
    await f.close();
  }
});

it('refuses a preview of another business of the same company as unknown', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({ businessId: f.secondBusiness });
    await expect(f.commit.execute(command(f, previewId))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
    expect(await f.outboxCount(previewId)).toBe(0);
  } finally {
    await f.close();
  }
});

it('refuses a preview of another entity as unknown', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({ entity: 'employees' });
    await expect(f.commit.execute(command(f, previewId))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
    expect(await f.outboxCount(previewId)).toBe(0);
  } finally {
    await f.close();
  }
});

it('refuses a preview created by another member as unknown', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({ createdBy: f.otherUserId });
    await expect(f.commit.execute(command(f, previewId))).rejects.toBeInstanceOf(ServiceImportError);
    await expect(f.commit.execute(command(f, previewId))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
    expect(await f.outboxCount(previewId)).toBe(0);
  } finally {
    await f.close();
  }
});

it('refuses a preview of another company as unknown', async () => {
  const f = await serviceImportFixture();
  try {
    const otherCompany = await f.h.onboard(f.ownerCookie, 'Other import employer');
    const otherBusiness = f.ids.newId();
    await f.h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
      VALUES (${otherCompany},${otherBusiness},'Other import business','salon')`;
    const foreign = await f.commitPreview({ companyId: otherCompany, businessId: otherBusiness });
    await expect(f.commit.execute(command(f, foreign))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
    expect(await f.outboxCount(foreign)).toBe(0);
  } finally {
    await f.close();
  }
});

it('locks the preview through the tenant primary key', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({});
    await f.seedPreviewRows(previewId, 500);
    const plan = await f.db.withTenant(f.company, async (tx) =>
      tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON)
        ${serviceImportCommitPreviewStatement(f.company, previewId)}`),
    );
    expect(JSON.stringify(plan)).toContain('import_previews_pkey');
  } finally {
    await f.close();
  }
});

it('accepts a five-hundred-row preview inside the 200 ms budget once warm', async () => {
  const f = await serviceImportFixture();
  try {
    // إحماء القبول أولاً: أول معاملة على اتصال جديد تحمل كلفة إعداد الاتصال.
    const warmupId = await f.commitPreview({});
    await f.commit.execute(command(f, warmupId, 'warmup-key'));
    const rows = Array.from({ length: 500 }, (_, index) => ({
      row: index + 2,
      name_en: `Service ${index}`,
      name_ar: null,
      price: '1.000',
      duration_minutes: null,
      category_id: null,
      category_name_en: null,
      commission_rule: { kind: 'FOLLOW_PLAN' },
      commission_value: null,
      commission_rule_defaulted: true,
      counts_toward_threshold: true,
    }));
    const previewId = f.ids.newId();
    const fileId = await f.fileRow();
    await f.h.owner`INSERT INTO import_previews
      (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
      VALUES (${f.company},${previewId},${f.business},'services',${fileId},${f.userId},
        '2026-11-22T09:00:00Z','2026-11-23T10:00:00Z',500,0,${JSON.stringify(rows)}::jsonb,'[]'::jsonb,'ready')`;
    const started = performance.now();
    await f.commit.execute(command(f, previewId, 'warm-key'));
    expect(performance.now() - started).toBeLessThan(200);
    const [row] =
      await f.h.owner`SELECT status FROM import_previews WHERE company_id=${f.company} AND id=${previewId}`;
    expect(row?.['status']).toBe('commit_requested');
    expect(await f.h.owner`SELECT id FROM services WHERE company_id=${f.company}`).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it('writes the commit event with the id-only payload of the preview', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({});
    await f.commit.execute(command(f, previewId));
    const [event] = await f.h.owner`SELECT event_type,payload FROM outbox
      WHERE aggregate_id=${previewId} AND event_type='ServiceImportCommitRequested'`;
    expect(event?.['event_type']).toBe('ServiceImportCommitRequested');
    expect(event?.['payload']).toEqual({ preview_id: previewId });
  } finally {
    await f.close();
  }
});

it('leaves no lock behind after the acceptance', async () => {
  const f = await serviceImportFixture();
  try {
    const previewId = await f.commitPreview({});
    await f.commit.execute(command(f, previewId));
    await expect(
      f.db.withTenant(f.company, async (tx) => {
        const rows = await tx.execute(
          sql`SELECT id FROM import_previews WHERE company_id=${f.company} AND id=${previewId} FOR UPDATE`,
        );
        return rows.length;
      }),
    ).resolves.toBe(1);
  } finally {
    await f.close();
  }
});
