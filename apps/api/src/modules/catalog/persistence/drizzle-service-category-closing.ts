import { appendAuditLogs, type IdGenerator, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import { ServiceCategoryError } from '../domain/errors.ts';
import type { ServiceRecordChange } from '../domain/service-category-closing.ts';
import { serviceCategorySnapshot, type ServiceCategoryRecord } from '../domain/service-category.ts';
import type { ServiceRecord } from '../domain/service.ts';
import type { ServiceCategoryClosingAudit } from '../ports/service-category-transactions.port.ts';

// صيغة اللحظة في تدقيق الخدمات: زي ما toISOString بيكتبها بالظبط (UTC، ثلاث خانات كسرية، Z)،
// والقطع قبلها بيضمن إن الأجزاء تحت الألف جزء بتتنسب زي ما JavaScript بيقراها، مش بتتقرب.
const ISO_INSTANT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

interface CascadeInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly categoryId: string;
  readonly closing: boolean;
  readonly closedAt: string | null;
  readonly marker: string | null;
  readonly at: string;
  readonly action: 'closed' | 'reopened';
  readonly auditIds: string;
  readonly expectedCount: number;
}

/** معرّفات صفوف التدقيق: بتتولّد في Node عشان تبقى UUID v7 من الـ IdGenerator زي كل تدقيق تاني. */
function auditIdsCte(input: CascadeInput): SQL {
  return sql`audit_ids AS (
    SELECT p.service_id, p.audit_id
    FROM jsonb_to_recordset(${input.auditIds}::jsonb) AS p(service_id uuid, audit_id uuid)
  )`;
}

/**
 * الصفوف القديمة قبل التحديث: نفس شرط القفل في lockServices، فالمجموعة اللي بتتغير هي اللي
 * خطط لها النطاق بالظبط. MATERIALIZED عشان الصفوف تتقرأ قبل ما التحديث يكتب.
 */
function oldRowsCte(input: CascadeInput): SQL {
  const state = input.closing
    ? sql`AND s.closed_at IS NULL`
    : sql`AND s.closed_by_category_id=${input.categoryId}`;
  return sql`old_rows AS MATERIALIZED (
    SELECT s.company_id, s.id, s.business_id, s.name_en, s.name_ar, s.price, s.commission_rule_kind,
      s.commission_pct_bps, s.commission_fixed_amount, s.counts_toward_threshold,
      s.duration_minutes, s.category_id, s.closed_at, s.closed_by_category_id,
      s.revision, s.created_at, s.updated_at
    FROM services s
    WHERE s.company_id=${input.companyId} AND s.business_id=${input.businessId}
      AND s.category_id=${input.categoryId} ${state}
  )`;
}

/** التحديث نفسه: جملة واحدة على كل المجموعة، والصف القديم والجديد بيرجعوا مع بعض في RETURNING. */
function updatedCte(input: CascadeInput): SQL {
  return sql`updated AS (
    UPDATE services s
    SET closed_at=${input.closedAt}::timestamptz, closed_by_category_id=${input.marker}::uuid,
      revision=s.revision+1, updated_at=${input.at}::timestamptz
    FROM old_rows o
    WHERE s.company_id=o.company_id AND s.id=o.id
    RETURNING o.id AS service_id, o.business_id, o.name_en, o.name_ar, o.price,
      o.commission_rule_kind, o.commission_pct_bps, o.commission_fixed_amount,
      o.counts_toward_threshold, o.duration_minutes, o.category_id, o.created_at,
      o.closed_at AS before_closed_at, o.closed_by_category_id AS before_marker,
      o.revision AS before_revision, o.updated_at AS before_updated_at,
      s.closed_at AS after_closed_at, s.closed_by_category_id AS after_marker,
      s.revision AS after_revision, s.updated_at AS after_updated_at
  )`;
}

/**
 * نسخة التدقيق بتتبني في SQL عشان الأثر كله يبقى جملة واحدة، فلازم تساوي serviceSnapshot في
 * domain/service.ts حرف بحرف: نفس الحقول، السعر نص بثلاث خانات، والوقت ISO. مفيش حقل سرّي
 * هنا فالتنقية ما كانتش هتغيّر الأرقام ولا الأسماء.
 */
function snapshotsCte(): SQL {
  return sql`snapshots AS (
    SELECT u.service_id, a.audit_id, u.after_closed_at, u.after_marker, u.after_revision,
      u.after_updated_at,
      jsonb_build_object(
        'id', u.service_id, 'business_id', u.business_id, 'name_en', u.name_en, 'name_ar', u.name_ar,
        'price', u.price::text,
        'commission_rule', CASE u.commission_rule_kind
          WHEN 'PCT' THEN jsonb_build_object('kind','PCT','value',COALESCE(u.commission_pct_bps,0))
          WHEN 'FIXED' THEN jsonb_build_object('kind','FIXED','value',COALESCE(u.commission_fixed_amount::text,'0.000'))
          WHEN 'ZERO' THEN jsonb_build_object('kind','ZERO')
          ELSE jsonb_build_object('kind','FOLLOW_PLAN')
        END,
        'counts_toward_threshold', u.counts_toward_threshold,
        'duration_minutes', u.duration_minutes, 'category_id', u.category_id,
        'closed_at', to_char(date_trunc('milliseconds', u.before_closed_at AT TIME ZONE 'UTC'), ${ISO_INSTANT}),
        'closed_by_category_id', u.before_marker, 'revision', u.before_revision,
        'created_at', to_char(date_trunc('milliseconds', u.created_at AT TIME ZONE 'UTC'), ${ISO_INSTANT}),
        'updated_at', to_char(date_trunc('milliseconds', u.before_updated_at AT TIME ZONE 'UTC'), ${ISO_INSTANT})
      ) AS before
    FROM updated u JOIN audit_ids a ON a.service_id=u.service_id
  )`;
}

/**
 * جملة الكاسكاد كلها: تحديث الخدمات وصفوف تدقيقها في أمر واحد. الـ "بعد" هو الـ "قبل" بالحقول
 * الأربعة المتغيّرة بس، فمجموعتا الحقول ما ينفصلوش عن بعض. والحارس على العدد بيخلّي الجملة
 * ما تكتبش تدقيق لمجموعة غير اللي اتخطط لها.
 */
function cascadeStatement(input: CascadeInput): SQL {
  return sql`WITH ${auditIdsCte(input)}, ${oldRowsCte(input)}, ${updatedCte(input)}, ${snapshotsCte()}
    INSERT INTO audit_log (company_id,id,actor_user_id,entity,entity_id,action,before,after)
    SELECT app_company_id(), s.audit_id, app_user_id(), 'service', s.service_id, ${input.action},
      s.before,
      s.before || jsonb_build_object(
        'closed_at', to_char(date_trunc('milliseconds', s.after_closed_at AT TIME ZONE 'UTC'), ${ISO_INSTANT}),
        'closed_by_category_id', s.after_marker, 'revision', s.after_revision,
        'updated_at', to_char(date_trunc('milliseconds', s.after_updated_at AT TIME ZONE 'UTC'), ${ISO_INSTANT})
      )
    FROM snapshots s
    WHERE (SELECT count(*) FROM updated) = ${input.expectedCount}
    RETURNING id`;
}

/**
 * يحفظ حالة التصنيف على نسخته المقفولة، ثم يغلق خدماته المفتوحة أو يفتح اللي هو أغلقها بجملة
 * واحدة تكتب تحديثها وصفوف تدقيقها مع بعض. المجموعة اللي بتتغير هي اللي خطّط لها النطاق تحت
 * القفل؛ لو اختلف عددها عن الخطة، المعاملة تتراجع والمدير يجرب من جديد.
 */
export async function saveClosing(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  category: ServiceRecordChange<ServiceCategoryRecord>,
  services: readonly ServiceRecordChange<ServiceRecord>[],
): Promise<void> {
  const categoryRows = await tx.execute(sql`UPDATE service_categories
    SET closed_at=${category.after.closed_at},updated_at=${category.after.updated_at},
      revision=${category.after.revision}
    WHERE company_id=${companyId} AND business_id=${category.before.business_id}
      AND id=${category.before.id} AND revision=${category.before.revision} RETURNING id`);
  if (categoryRows.length === 0)
    throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
  if (services.length === 0) return;
  const closing = category.before.closed_at === null;
  const audited = await tx.execute(
    cascadeStatement({
      companyId,
      businessId: category.before.business_id,
      categoryId: category.before.id,
      closing,
      closedAt: closing ? category.after.updated_at : null,
      marker: closing ? category.before.id : null,
      at: category.after.updated_at,
      action: closing ? 'closed' : 'reopened',
      auditIds: JSON.stringify(
        services.map((service) => ({ service_id: service.before.id, audit_id: ids.newId() })),
      ),
      expectedCount: services.length,
    }),
  );
  if (audited.length !== services.length)
    throw new ServiceCategoryError('TRANSACTION_RETRY_REQUIRED');
}

/**
 * تدقيق التصنيف نفسه: صف واحد العملية. تدقيق الخدمات كاتبه جملة الكاسكاد مع تحديثها، عشان
 * الأثر كله يبقى ذري في أمر واحد.
 */
export async function auditClosing(
  tx: Tx,
  ids: IdGenerator,
  closing: ServiceCategoryClosingAudit,
): Promise<void> {
  await appendAuditLogs(tx, [
    {
      id: ids.newId(),
      entry: {
        entity: 'service_category',
        entityId: closing.category.after.id,
        action: closing.action,
        before: serviceCategorySnapshot(closing.category.before),
        after: serviceCategorySnapshot(closing.category.after),
      },
    },
  ]);
}
