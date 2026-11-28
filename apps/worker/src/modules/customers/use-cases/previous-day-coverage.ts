import type { BranchSchedule, LegacyOvernightCoverage } from '../domain/sessions-of-day.ts';
import type { PreviousDayRatingRequestRow } from '../ports/rating-request.repository.ts';
import type { BranchScheduleHoursPort } from '../ports/branch-schedule-hours.port.ts';
import { addCivilDays } from '../domain/zoned-time.ts';

/** قارئ اختياري لطلب اليوم المدني السابق للاستخدام المشترك بين الجدولة والمطالبة. */
export type PreviousDayRequestLookup<Transaction = unknown> = (
  tx: Transaction,
  key: {
    readonly companyId: string;
    readonly businessId: string;
    readonly customerId: string;
    readonly previousDate: string;
  },
) => Promise<PreviousDayRatingRequestRow | null>;

async function resolveBranchPlace<Transaction>(
  tx: Transaction,
  companyId: string,
  branchId: string,
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
  hours: BranchScheduleHoursPort<Transaction>,
): Promise<BranchSchedule> {
  const place = placeByBranch.get(branchId) ?? (await hours.hours(tx, companyId, branchId));
  if (place === null) throw new Error('RATING_BRANCH_NOT_FOUND');
  return place;
}

/**
 * يبني سياق تغطية الطلبات الليلية ليوم الطلب الحالي واليوم المدني السابق عند وجود زيارات غير موسومة.
 *
 * @param tx معاملة المستأجر
 * @param params معرّفات الطلب والفروع المحمَّلة ونطاق اليوم
 * @param params.companyId معرف الشركة
 * @param params.businessId معرف النشاط
 * @param params.customerId معرف العميل
 * @param params.day يوم الطلب الجاري تقييمه بصيغة YYYY-MM-DD
 * @param params.hasUnassignedLines هل توجد بنود غير مثبت يوم طلبها تحتاج الحسم
 * @param params.currentRequest بيانات طلب اليوم الحالي إن وُجد
 * @param params.placeByBranch مواعيد الفروع المحمَّلة مسبقاً
 * @param params.hours منفذ قراءة مواعيد الفروع ومناطقها الزمنية
 * @param params.findPreviousDayRequest قارئ طلب اليوم المدني السابق إن توفر
 * @returns سياق التغطية الليلية أو undefined عند عدم الحاجة إليه
 */
export async function loadLegacyOvernightCoverage<Transaction>(
  tx: Transaction,
  params: {
    readonly companyId: string;
    readonly businessId: string;
    readonly customerId: string;
    readonly day: string;
    readonly hasUnassignedLines: boolean;
    readonly currentRequest?: {
      readonly branchId: string;
      readonly dueAt: Date;
      readonly sendDeadline: Date | null;
      readonly claimedAt?: Date | null;
    };
    readonly placeByBranch: ReadonlyMap<string, BranchSchedule>;
    readonly hours: BranchScheduleHoursPort<Transaction>;
    readonly findPreviousDayRequest?: PreviousDayRequestLookup<Transaction> | undefined;
  },
): Promise<LegacyOvernightCoverage | undefined> {
  const { currentRequest, placeByBranch, hours, companyId } = params;
  const requestPlace =
    currentRequest !== undefined && currentRequest.sendDeadline !== null
      ? await resolveBranchPlace(tx, companyId, currentRequest.branchId, placeByBranch, hours)
      : undefined;
  const previousRow =
    params.hasUnassignedLines && params.findPreviousDayRequest !== undefined
      ? await params.findPreviousDayRequest(tx, {
          companyId,
          businessId: params.businessId,
          customerId: params.customerId,
          previousDate: addCivilDays(params.day, -1),
        })
      : null;
  const previousPlace =
    previousRow !== null
      ? await resolveBranchPlace(tx, companyId, previousRow.branchId, placeByBranch, hours)
      : undefined;
  if (requestPlace === undefined && previousRow === null) return undefined;
  return {
    ...(currentRequest !== undefined && requestPlace !== undefined
      ? {
          request: {
            businessDate: params.day,
            branchId: currentRequest.branchId,
            dueAt: currentRequest.dueAt,
            sendDeadline: currentRequest.sendDeadline,
            claimedAt: currentRequest.claimedAt ?? null,
          },
          requestBranchTimeZone: requestPlace.timeZone,
        }
      : {}),
    ...(previousRow !== null && previousPlace !== undefined
      ? { previousDayRequest: previousRow, previousRequestBranchTimeZone: previousPlace.timeZone }
      : {}),
  };
}
