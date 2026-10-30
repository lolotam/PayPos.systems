import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  RatingSubmissionBusyError,
  type ConsumeAndRateInput,
  type RatingSubmissionScope,
  type RatingSubmissionTransactions,
  type RatingViewRow,
} from '../ports/rating-submission.port.ts';

import { isRatingTransactionBusy } from './rating-transaction-busy.ts';

type ViewRow = {
  expires_at: string | null;
  consumed_at: string | null;
  locale: 'ar' | 'en';
  name_ar: string | null;
  name_en: string;
};
type RequestRow = { id: string; business_id: string; branch_id: string };
type PerformerRow = { employee_id: string };

async function findView(
  tx: Tx,
  companyId: string,
  tokenHash: Buffer,
): Promise<RatingViewRow | null> {
  // قراءة بس: الصفحة تعرّف اسم النشاط ولغة العميل من غير ما تقفل أو تكتب حاجة.
  const [row] = await tx.execute<ViewRow>(sql`
    SELECT r.expires_at, r.consumed_at, c.locale, b.name_ar, b.name_en
    FROM rating_requests r
    JOIN customers c ON c.company_id = r.company_id AND c.id = r.customer_id
    JOIN businesses b ON b.company_id = r.company_id AND b.id = r.business_id
    WHERE r.company_id = ${companyId} AND r.token_hash = ${tokenHash} AND r.expires_at IS NOT NULL`);
  if (row === undefined || row.expires_at === null) return null;
  return {
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at === null ? null : new Date(row.consumed_at),
    locale: row.locale,
    nameAr: row.name_ar,
    nameEn: row.name_en,
  };
}

async function lockRequest(tx: Tx, companyId: string, tokenHash: Buffer): Promise<boolean> {
  // القفل على صف الطلب نفسه: طلبان لنفس التوكن ما يستهلكوش مرتين، والوقت بيتقري بعد القفل.
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM rating_requests
    WHERE company_id = ${companyId} AND token_hash = ${tokenHash}
    FOR UPDATE`);
  return rows.length > 0;
}

async function consumeAndRate(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  input: ConsumeAndRateInput,
): Promise<boolean> {
  const stamp = input.now.toISOString();
  // شرط الاستهلاك هو شرط الصلاحية: لو الرابط خلص في نفس اللحظة دي، يبقى مش متاح.
  const consumed = await tx.execute<RequestRow>(sql`
    UPDATE rating_requests SET consumed_at = ${stamp}, updated_at = ${stamp}
    WHERE company_id = ${companyId} AND token_hash = ${input.tokenHash}
      AND consumed_at IS NULL AND expires_at > ${stamp}
    RETURNING id, business_id, branch_id`);
  const request = consumed[0];
  if (request === undefined) return false;

  const ratingId = ids.newId();
  await tx.execute(sql`
    INSERT INTO ratings(company_id, id, request_id, business_id, branch_id, stars, comment, submitted_at)
    VALUES (${companyId}, ${ratingId}, ${request.id}, ${request.business_id}, ${request.branch_id},
      ${input.stars}, ${input.comment}, ${stamp})`);

  // النسبة بتاخد من لقطة المتصرفين في الطلب نفسه، مش من جسم الطلب: العميل مش بيسمعش مين بيقيّم.
  const performers = await tx.execute<PerformerRow>(sql`
    SELECT employee_id FROM rating_performers
    WHERE company_id = ${companyId} AND business_id = ${request.business_id}
      AND request_id = ${request.id}`);
  for (const performer of performers) {
    await tx.execute(sql`
      INSERT INTO rating_attributions(company_id, id, rating_id, request_id, employee_id, business_id,
        branch_id, stars, submitted_at)
      VALUES (${companyId}, ${ids.newId()}, ${ratingId}, ${request.id}, ${performer.employee_id},
        ${request.business_id}, ${request.branch_id}, ${input.stars}, ${stamp})`);
  }
  return true;
}

/**
 * معاملة تقييم العميل: بتعمل جوه الشركة المختارة من بادئة الرابط، من غير مستخدم (ADR-0011 §1).
 * الطلب بيتقفل `FOR UPDATE` قبل ما الوقت يتقري، وبعدين الاستهلاك والتقييم والنسب كلهم في نفس المعاملة —
 * أي فشل في النسبة بيرجّع الاستهلاك كله (ADR-0011 §2).
 *
 * @param db        أغلفة الداتابيز المستأجرة
 * @param ids       مولّد الـ ids للتقييم والنسب
 * @param timeoutMs أقصى عمر للمعاملة كلها، عشان القفل ما يعلّقش الطلب
 * @returns معاملة تقييم العميل
 */
export function createRatingSubmissionTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
  timeoutMs: number,
): RatingSubmissionTransactions {
  return {
    run: async (companyId, work) => {
      try {
        return await db.withTenant(
          companyId,
          async (tx) =>
            work({
              findView: (tokenHash) => findView(tx, companyId, tokenHash),
              lockRequest: (tokenHash) => lockRequest(tx, companyId, tokenHash),
              consumeAndRate: (input) => consumeAndRate(tx, companyId, ids, input),
            } satisfies RatingSubmissionScope),
          { timeoutMs },
        );
      } catch (error) {
        if (error instanceof RatingSubmissionBusyError) throw error;
        if (isRatingTransactionBusy(error)) throw new RatingSubmissionBusyError();
        throw error;
      }
    },
  };
}
