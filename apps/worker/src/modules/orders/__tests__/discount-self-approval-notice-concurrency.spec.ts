import { createDatabase, type Tx } from '@pospay/db';
import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { DiscountSelfApprovalNoticeNameFallback } from '../domain/discount-self-approval-notice.ts';
import { onDiscountApprovedByPerformer } from '../events/handlers/on-discount-approved-by-performer.handler.ts';
import { alertRules } from '../persistence/alert-rule.adapter.ts';
import { discountSelfApprovalRecipients } from '../persistence/discount-self-approval-recipients.adapter.ts';
import { discountSelfApprovalRepository } from '../persistence/discount-self-approval-notice.repository.ts';
import type { DiscountSelfApprovalNoticeOutbox } from '../ports/discount-self-approval-notice.port.ts';
import { discountApprovalPlace } from '../persistence/discount-approval-place.adapter.ts';
import { createDiscountSelfApprovalNoticeConsumer } from '../index.ts';
import { RequestDiscountSelfApprovalNotice } from '../use-cases/request-discount-self-approval-notice/request-discount-self-approval-notice.ts';
import type { PreparedDecision } from './discount-self-approval-notice-data.ts';
import {
  discountSelfApprovalFixture,
  type DiscountSelfApprovalFixture,
} from './discount-self-approval-notice.fixture.ts';

let f: DiscountSelfApprovalFixture;
beforeAll(async () => {
  f = await discountSelfApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('concurrency A: the same claimed event delivered in parallel applies once through consumed_events', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  // postgres.js يفضّل خطّ الأوامر على اتصال مشغول فوق فتح اتصال جديد، فندّان من نفس الـ pool
  // يتسلسلان على نفس الـ socket صامتين — الندّ الثاني يأخذ pool مستقلاً حتى يكون الاحتكاك حقيقياً على consumed_events.
  const secondPool = peerPool();
  try {
    // تسخين مسبق: backend الندّ الثاني يتفتح وهو خامل قبل الحاجز، لأن فتح اتصال جديد
    // لنفس قاعدة الـ fixture والندّ الأول معلّق على قفل لا يكتمل في هذه البيئة.
    await secondPool.ping();
    const deliver2 = createDeliverer(
      secondPool,
      [createDiscountSelfApprovalNoticeConsumer(f.ids, { now: () => f.at })],
      createLogger('silent'),
      { knownEventTypes: f.consumer.eventTypes },
    );
    // حاجز ACCESS EXCLUSIVE على consumed_events يجمع الندّين على القفل معاً، وpg_stat_activity
    // يرصدهما معلّقين قبل الإفراج — تزامن ملحوظ لا ترتيب نداء.
    const outcomes = await withLockBarrier(
      'consumed_events',
      () => f.deliver(prepared.event),
      () => deliver2(prepared.event),
    );
    expect(outcomes).toEqual([{ delivered: true }, { delivered: true }]);
    expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(1);
    expect(await f.consumed(prepared.companyId, prepared.event.id)).toHaveLength(1);
  } finally {
    await secondPool.close();
  }
});

it('concurrency B: two direct consumer transactions on the same event arbitrate on the ledger unique key', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  // pool مستقل للندّ الثاني (نفس سبب اختبار A)، والحاجز على صفّ الدفتر يجمع المعاملتين
  // على إدخال الحجز معاً قبل الإفراج؛ الفائز الواحد لنفس مفتاح الحدث المصدر يثبت الاحتكاك الفعلي.
  const secondPool = peerPool();
  try {
    await secondPool.ping();
    const consumer2 = createDiscountSelfApprovalNoticeConsumer(f.ids, { now: () => f.at });
    await withLockBarrier(
      'discount_self_approval_notices',
      () => f.consume(prepared.event),
      () =>
        secondPool.withTenant(prepared.event.companyId, (tx) =>
          consumer2.handle(tx, prepared.event),
        ),
    );
    expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(1);
    const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
    expect(await f.decisions(prepared.companyId, ledger?.['id'] as string)).toHaveLength(1);
  } finally {
    await secondPool.close();
  }
});

it('a throwing outbox after the claim rolls the whole transaction back', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  const deliver = createDeliverer(
    f.db,
    [
      {
        ...f.consumer,
        handle: (tx, event) => onDiscountApprovedByPerformer(brokenUseCase(tx), event),
      },
    ],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  const outcome = await deliver(prepared.event);
  expect(outcome.delivered).toBe(false);
  // لا دفتر ولا أوتبوكس ولا علامة استهلاك للحدث نفسه: الاسترجاع مسّ كل شيء أو لم يمسّ شيئًا.
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(0);
  expect(await outboundFor(prepared)).toHaveLength(0);
  expect(await f.consumed(prepared.companyId, prepared.event.id)).toHaveLength(0);
});

/** pool تاني بنفس بيانات الاتصال للندّ الثاني — اتصالان backend فعليان بدل خطّ متسلسل على نفس الـ socket. */
function peerPool() {
  return createDatabase({ url: f.testDb.appUrl, ids: f.ids, maxConnections: 2 });
}

interface UnsafeSql {
  unsafe(query: string): Promise<readonly unknown[]>;
}

/**
 * يمسك قفل ACCESS EXCLUSIVE على جدول الاختبار الخاص بالـ fixture، يشغّل ندّاً أول ويثبت بالرصد
 * (pg_stat_activity/pg_blocking_pids عبر waitBlocked) إنه داخل معاملته، ثم يشغّل الندّ الثاني
 * ولا يُفرج إلا بعد رصد الاثنين منخرطين معاً — ثم يُغلق begin فيُحرر القفل فوراً وينتظر الندّان
 * خارج الحاجز، فيكون الاحتكاك بعد الإفراج حقيقياً على consumed_events / مفتاح الدفتر الفريد.
 * عند فشل الرصد يُغلق begin بالاسترجاع (يحرر القفل)، وتُصرَّف الوعود في allSettled قبل إعادة الخطأ.
 */
async function withLockBarrier<T>(
  table: 'consumed_events' | 'discount_self_approval_notices',
  first: () => Promise<T>,
  second: () => Promise<T>,
): Promise<[T, T]> {
  const one = first();
  one.catch(() => undefined);
  let two: Promise<T> | undefined;
  let observation: unknown;
  try {
    await f.owner.begin(async (tx) => {
      await tx.unsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      await waitBlocked(tx, 1);
      two = second();
      two.catch(() => undefined);
      await waitBlocked(tx, 2);
    });
  } catch (error) {
    observation = error;
  }
  const peers: Promise<T>[] = two === undefined ? [one] : [one, two];
  await Promise.allSettled(peers);
  if (observation !== undefined) throw observation;
  return [await one, await (two as Promise<T>)];
}

interface AppBackend {
  pid: number;
  usename?: string;
  state: string;
  wait: string | null;
  blocked_by: readonly number[];
  in_tx: boolean;
  query: string;
}

/** استطلاع محدود (25ms × 60 ≈ 1.5s) حتى يثبت أن minimum اتصال تطبيق منخرط تحت الحاجز وأحدهم محجوب فعلاً. */
async function waitBlocked(tx: UnsafeSql, minimum: number): Promise<void> {
  const observe = `SELECT a.pid, a.state, a.wait_event_type AS wait, pg_blocking_pids(a.pid) AS blocked_by,
      a.xact_start IS NOT NULL AS in_tx, left(a.query, 80) AS query
    FROM pg_stat_activity a
    WHERE a.datname = current_database() AND a.usename = 'pospay_app'
    ORDER BY a.pid`;
  const observeAll = `SELECT a.pid, a.usename, a.state, a.wait_event_type AS wait,
      left(a.query, 60) AS query
    FROM pg_stat_activity a
    WHERE a.datname = current_database()
    ORDER BY a.pid`;
  const seen: AppBackend[][] = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = (await tx.unsafe(observe)) as AppBackend[];
    // "engaged": داخل معاملة أو في انتظار قفل — اتصال الخمول من الـ pool لا يُحسب.
    const engaged = snapshot.filter((row) => row.in_tx || row.wait !== null);
    const blocked = engaged.filter((row) => row.blocked_by.length > 0);
    if (engaged.length >= minimum && blocked.length > 0) return;
    if (seen.length === 0 || JSON.stringify(seen[seen.length - 1]) !== JSON.stringify(snapshot)) {
      seen.push(snapshot);
      if (seen.length > 8) seen.shift();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const everyone = (await tx.unsafe(observeAll)) as AppBackend[];
  throw new Error(
    `barrier observed fewer than ${minimum} overlapping app backends: app=${JSON.stringify(seen)} all=${JSON.stringify(everyone)}`,
  );
}

function bind(tx: Tx, outbox: DiscountSelfApprovalNoticeOutbox) {
  return new RequestDiscountSelfApprovalNotice(
    {
      recipients: discountSelfApprovalRecipients(tx),
      place: discountApprovalPlace(tx),
      repository: discountSelfApprovalRepository(tx),
      outbox,
      rules: alertRules(tx),
    },
    f.ids,
    { now: () => f.at },
    fallback(),
  );
}

function brokenUseCase(tx: Tx) {
  return bind(tx, {
    append: async () => {
      throw new Error('synthetic outbox failure');
    },
  });
}

function outboundFor(prepared: PreparedDecision) {
  return f.owner`SELECT id FROM outbox WHERE company_id=${prepared.companyId}
    AND event_type='DiscountSelfApprovalNoticeRequested' AND payload->>'business_id'=${prepared.businessId}`;
}

function fallback(): DiscountSelfApprovalNoticeNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    approver: { ar: t('ar', 'inApp.editor_generic'), en: t('en', 'inApp.editor_generic') },
    safeName: safeDisplayName,
  };
}
