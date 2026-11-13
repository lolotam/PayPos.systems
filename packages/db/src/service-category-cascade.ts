import { sql, type SQL } from 'drizzle-orm';

import type { Tx } from './with-tenant.ts';

// صيغة اللحظة في تدقيق الخدمات: زي ما toISOString بيكتبها بالظبط (UTC، ثلاث خانات كسرية، Z)،
// والقطع قبلها بيضمن إن الأجزاء تحت الألف جزء بتتنسب زي ما JavaScript بيقراها، مش بتتقرب.
const ISO_INSTANT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

/** مدخلات الكاسكاد المشترك تربط نطاق التصنيف ووقته بخطة العدد ومعرّفات التدقيق المولّدة مسبقاً. */
export interface ServiceCategoryCascadeInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly categoryId: string;
  readonly closing: boolean;
  readonly at: string;
  readonly auditIds: string;
  readonly expectedCount: number;
}

/** معالم الأثر المشتقة من حالة الإغلاق، وكلها بتتحدد مع بعض. */
interface CascadeEffect {
  readonly closedAt: string | null;
  readonly marker: string | null;
  readonly action: 'closed' | 'reopened';
}

/**
 * الأثر المشتق من حالة الإغلاق: وقت الإغلاق وعلامة التصنيف ونوع الفعل بييجوا من حالة واحدة،
 * فما ينفع واحد يتناقض مع التانية.
 */
function cascadeEffect(input: ServiceCategoryCascadeInput): CascadeEffect {
  return {
    closedAt: input.closing ? input.at : null,
    marker: input.closing ? input.categoryId : null,
    action: input.closing ? 'closed' : 'reopened',
  };
}

/** معرّفات صفوف التدقيق: بتتولّد في Node عشان تبقى UUID v7 من الـ IdGenerator زي كل تدقيق تاني. */
function auditIdsCte(input: ServiceCategoryCascadeInput): SQL {
  return sql`audit_ids AS (
    SELECT p.service_id, p.audit_id
    FROM jsonb_to_recordset(${input.auditIds}::jsonb) AS p(service_id uuid, audit_id uuid)
  )`;
}

/**
 * الصفوف القديمة قبل التحديث: نفس شرط القفل في lockServices، فالمجموعة اللي بتتغير هي اللي
 * خطط لها النطاق بالظبط. MATERIALIZED عشان الصفوف تتقرأ قبل ما التحديث يكتب.
 */
function oldRowsCte(input: ServiceCategoryCascadeInput): SQL {
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
function updatedCte(input: ServiceCategoryCascadeInput): SQL {
  const effect = cascadeEffect(input);
  return sql`updated AS (
    UPDATE services s
    SET closed_at=${effect.closedAt}::timestamptz, closed_by_category_id=${effect.marker}::uuid,
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
 *
 * @param input نطاق التصنيف والوقت ومعرّفات التدقيق والعدد المتوقع
 * @returns جملة SQL التي تحدث الخدمات وتكتب تدقيقها معاً
 */
export function serviceCategoryCascadeStatement(input: ServiceCategoryCascadeInput): SQL {
  const effect = cascadeEffect(input);
  return sql`WITH ${auditIdsCte(input)}, ${oldRowsCte(input)}, ${updatedCte(input)}, ${snapshotsCte()}
    INSERT INTO audit_log (company_id,id,actor_user_id,entity,entity_id,action,before,after)
    SELECT app_company_id(), s.audit_id, app_user_id(), 'service', s.service_id, ${effect.action},
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

interface ApplyServiceCategoryClosingInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly categoryId: string;
  readonly closing: boolean;
  readonly at: string;
  readonly expectedRevision: number;
  readonly categoryAuditId: string;
}

// النسخة دي لازم تطابق serviceCategorySnapshot في domain بتاع الـ api حقل بحقل: نفس المفاتيح وأوقات ISO مقطوعة على المللي ثانية، واختبار التكافؤ في الـ api هو اللي بيبرهن على ده.
function serviceCategorySnapshotSql(closedAt: SQL, revision: SQL, updatedAt: SQL): SQL {
  return sql`jsonb_build_object(
    'id', u.id, 'business_id', u.business_id, 'name_en', u.name_en, 'name_ar', u.name_ar,
    'owner_branch_id', u.owner_branch_id, 'visibility', u.visibility,
    'closed_at', to_char(date_trunc('milliseconds', ${closedAt} AT TIME ZONE 'UTC'), ${ISO_INSTANT}),
    'revision', ${revision},
    'created_at', to_char(date_trunc('milliseconds', u.created_at AT TIME ZONE 'UTC'), ${ISO_INSTANT}),
    'updated_at', to_char(date_trunc('milliseconds', ${updatedAt} AT TIME ZONE 'UTC'), ${ISO_INSTANT})
  )`;
}

function categoryClosingStatement(input: ApplyServiceCategoryClosingInput): SQL {
  const closedAt = input.closing ? input.at : null;
  const action = input.closing ? 'closed' : 'reopened';
  return sql`WITH old_category AS MATERIALIZED (
    SELECT id,business_id,name_en,name_ar,owner_branch_id,visibility,closed_at,revision,created_at,updated_at
    FROM service_categories
    WHERE company_id=${input.companyId} AND business_id=${input.businessId} AND id=${input.categoryId}
  ), updated_category AS (
    UPDATE service_categories n
    SET closed_at=${closedAt}::timestamptz, revision=n.revision+1, updated_at=${input.at}::timestamptz
    FROM old_category o
    WHERE n.company_id=${input.companyId} AND n.business_id=${input.businessId} AND n.id=${input.categoryId}
      AND n.revision=${input.expectedRevision}
    RETURNING o.id,o.business_id,o.name_en,o.name_ar,o.owner_branch_id,o.visibility,
      o.closed_at,o.revision,o.created_at,o.updated_at,
      n.closed_at AS after_closed_at,n.revision AS after_revision,n.updated_at AS after_updated_at
  )
  INSERT INTO audit_log (company_id,id,actor_user_id,entity,entity_id,action,before,after)
  SELECT app_company_id(), ${input.categoryAuditId}, app_user_id(), 'service_category', u.id, ${action},
    ${serviceCategorySnapshotSql(sql`u.closed_at`, sql`u.revision`, sql`u.updated_at`)},
    ${serviceCategorySnapshotSql(sql`u.after_closed_at`, sql`u.after_revision`, sql`u.after_updated_at`)}
  FROM updated_category u
  RETURNING id`;
}

/**
 * يطبّق نتيجة قفل التصنيف ويكتب تدقيقها في جملة واحدة حتى لا يوجد تحديث بلا أثر تدقيقي.
 * شرط النسخة يمنع العامل من الكتابة فوق تعديل حدث بعد قبول الطلب، والقفل نفسه يبقى على المستدعي
 * حتى لا يتغير ترتيب الأقفال المتفق عليه بين مساري الـ API والعامل.
 *
 * @param tx معاملة المستأجر التي تحمل قفل التصنيف
 * @param input نطاق التصنيف وحالة القفل والوقت والنسخة المتوقعة ومعرّف التدقيق
 * @returns applied عند التحديث وكتابة التدقيق، أو revision-conflict عند اختلاف النسخة
 */
export async function applyServiceCategoryClosing(
  tx: Tx,
  input: ApplyServiceCategoryClosingInput,
): Promise<'applied' | 'revision-conflict'> {
  const rows = await tx.execute(categoryClosingStatement(input));
  return rows.length === 0 ? 'revision-conflict' : 'applied';
}

interface LockServiceCategoryCascadeServicesInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly categoryId: string;
  readonly closing: boolean;
}

/**
 * يقفل خدمات الكاسكاد بترتيب ثابت حتى يعدّها العامل ويطابقها مع العدد المتوقع قبل التحديث.
 * اختيار المفتوحة فقط أو الموسومة بالتصنيف يمنع فتح خدمة أغلقها المدير منفردة، والترتيب يمنع
 * تعارض الأقفال مع بقية مسارات الكتابة.
 *
 * @param tx معاملة المستأجر الحالية
 * @param input نطاق التصنيف وهل العملية قفل أم فتح
 * @returns معرّفات الخدمات المقفولة مرتبة تصاعدياً
 */
export async function lockServiceCategoryCascadeServices(
  tx: Tx,
  input: LockServiceCategoryCascadeServicesInput,
): Promise<string[]> {
  const state = input.closing
    ? sql`closed_at IS NULL`
    : sql`closed_by_category_id=${input.categoryId}`;
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM services
    WHERE company_id=${input.companyId} AND business_id=${input.businessId}
      AND category_id=${input.categoryId} AND ${state}
    ORDER BY id FOR NO KEY UPDATE`);
  return rows.map((row) => row.id);
}
