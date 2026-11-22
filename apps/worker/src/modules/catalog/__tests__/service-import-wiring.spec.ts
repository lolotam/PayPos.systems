import { expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { ClaimedEvent, DeliveryOutcome, TenantWrappers } from '@pospay/db';

import { startCatalogWorker } from '../catalog.module.ts';

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
      // ورفضه قابل لإعادة التسليم كأي فشل طابور (اتساق موظف الاستيراد).
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
        error: 'SERVICE_IMPORT_QUEUE_RETRY',
        retryInMs: 2000,
      });
      expect(nextSpy).not.toHaveBeenCalled();
    } finally {
      await worker.close();
    }
  },
);
