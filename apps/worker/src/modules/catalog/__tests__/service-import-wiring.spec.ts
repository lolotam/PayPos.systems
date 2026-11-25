import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, DeliveryOutcome, TenantWrappers } from '@pospay/db';

import { startCatalogWorker } from '../catalog.module.ts';
import { SERVICE_IMPORT_RECOVERY_QUEUE } from '../jobs/service-import-recovery.processor.ts';

// حدث الاستيراد مسجّل باستهلك يُسلك في الطابور، وأحداث قفل التصنيف القديمة تظل تُسلَّم،
// والأحداث الغريبة تمرّ للتالي، والعامل يجهز ويقفل بنظافة (حدود 32b-3). فرع قفل التصنيف
// الحقيقي مسند إلى مواصفة القفل نفسها؛ هنا يكفي ثبات التوجيهات الجديدة.

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

it(
  'registers both catalog events, routes the rest onward, and closes cleanly',
  { timeout: 60_000 },
  async () => {
    const ids = systemUuidV7();
    const worker = startCatalogWorker(
      {} as Pick<TenantWrappers, 'withTenant'>,
      ids,
      redisUrl,
      { now: () => new Date() },
      `catalog-wiring-${ids.newId()}`,
    );
    try {
      await worker.ready();
      expect(worker.eventTypes).toEqual(
        expect.arrayContaining(['ServiceCategoryClosingRequested', 'ServiceImportCommitRequested']),
      );
      const next = vi.fn(async (): Promise<DeliveryOutcome> => ({
        delivered: false,
        error: 'UNRELATED',
        retryInMs: null,
      }));
      const unrelated: ClaimedEvent = {
        companyId: ids.newId(),
        id: ids.newId(),
        aggregateId: ids.newId(),
        aggregateType: 'employee',
        eventType: 'SalaryChanged',
        payload: {},
        attempt: 1,
      };
      await worker.deliver(unrelated, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(unrelated);
      // حدث الاستيراد بحمولة مكسورة يذهب إلى فرع الاستيراد الجديد ولا يمر إلى التالي،
      // ويرفضه فحص العقد الصارم رفضًا غير قابل لإعادة السحب (P2 مراجعة 32b-2).
      const broken: ClaimedEvent = {
        companyId: ids.newId(),
        id: ids.newId(),
        aggregateId: ids.newId(),
        aggregateType: 'import_preview',
        eventType: 'ServiceImportCommitRequested',
        payload: {},
        attempt: 1,
      };
      const nextSpy = vi.fn(async (): Promise<DeliveryOutcome> => ({
        delivered: false,
        error: 'UNREACHABLE',
        retryInMs: null,
      }));
      expect(await worker.deliver(broken, nextSpy)).toEqual({
        delivered: false,
        error: 'SERVICE_IMPORT_COMMIT_EVENT_INVALID',
        retryInMs: null,
      });
      expect(nextSpy).not.toHaveBeenCalled();
    } finally {
      await worker.close();
    }
  },
);

it(
  'registers the per-company recovery sweep before acknowledging a commit request',
  { timeout: 60_000 },
  async () => {
    const ids = systemUuidV7();
    const prefix = `catalog-recovery-wiring-${ids.newId()}`;
    const companyId = ids.newId();
    const previewId = ids.newId();
    const worker = startCatalogWorker(
      {} as Pick<TenantWrappers, 'withTenant'>,
      ids,
      redisUrl,
      { now: () => new Date() },
      prefix,
    );
    const queue = new Queue(SERVICE_IMPORT_RECOVERY_QUEUE, {
      connection: { url: redisUrl },
      prefix,
    });
    try {
      await worker.ready();
      const event: ClaimedEvent = {
        companyId,
        id: ids.newId(),
        aggregateId: previewId,
        aggregateType: 'import_preview',
        eventType: 'ServiceImportCommitRequested',
        payload: { preview_id: previewId },
        attempt: 1,
      };
      const next = vi.fn(async (): Promise<DeliveryOutcome> => ({
        delivered: false,
        error: 'UNREACHABLE',
        retryInMs: null,
      }));
      expect(await worker.deliver(event, next)).toEqual({
        delivered: true,
      });
      const schedulers = await queue.getJobSchedulers();
      const matches = schedulers.filter(
        (entry) => entry.key === `service-import-recovery-${companyId}`,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.every).toBe(60_000);
      expect(matches[0]?.template?.data).toEqual({ companyId });
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  },
);
