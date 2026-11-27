import type { EditorLabelSnapshot } from '@pospay/i18n';

import { formatLocalDate } from './attendance-exception-notice.ts';
import { formatLocalShiftStart } from './not-clocked-in.ts';

/** أنواع جرس وصول الدخول: منح الدخول، إعادة ضبط الرقم السري من غير نفسها، أو استعادته بنفسها (076-F2b-4، 079-c1). */
export type StaffAccessNoticeKind =
  'staff_access_granted' | 'staff_pin_set_by_other' | 'staff_pin_recovered';

/**
 * تسميات الكتالوج ودالة الاسم الآمن وتسمية الفاعل؛ تُحقن من التوصيل حتى يبقى domain خالصاً.
 * `actorText` هي `editorLabel` من packages/i18n: الاسم الآمن ثم الدور ثم التسمية العامة.
 */
export interface StaffAccessNoticeFallback {
  readonly employee: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly actor: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
  readonly actorText: (locale: 'ar' | 'en', snapshot: EditorLabelSnapshot) => string;
}

/** ترتيب قالبَي جرس وصول الدخول ثابت؛ بلا رقم سري ولا hash ولا هاتف (076-F2b-4). */
export type StaffAccessNoticeParameters = [
  { name: 'employee_name_ar'; type: 'text'; value: string },
  { name: 'employee_name_en'; type: 'text'; value: string },
  { name: 'actor_name_ar'; type: 'text'; value: string },
  { name: 'actor_name_en'; type: 'text'; value: string },
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'occurred_date'; type: 'text'; value: string },
  { name: 'occurred_time'; type: 'text'; value: string },
];

/** مدخلات معاملات الجرس: لقطات الأسماء ولحظة الفعل وتوقيت الفرع والتسميات المحقونة. */
export interface StaffAccessNoticeParameterInput {
  readonly employee: { readonly nameAr: string | null; readonly nameEn: string };
  readonly actor: EditorLabelSnapshot;
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string };
  readonly occurredAt: Date;
  readonly timeZone: string;
  readonly fallback: StaffAccessNoticeFallback;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * يجهّز معاملات قالبَي جرس وصول الدخول بترتيبهما الثماني الثابت.
 * العربي الغائب أو المرفوض يرجع للإنجليزي السليم وإلا للتسمية العامة الآمنة، والإنجليزي لا يرجع للعربي.
 * اسم الفاعل آمن حتى لو كان اسم دور مخزّن غير مقبول، وإلا للتسمية العامة الآمنة.
 *
 * @param input لقطات الأسماء ولحظة الفعل وتوقيت الفرع والتسميات المحقونة
 * @param input.employee اسم الموظفة العربي والإنجليزي
 * @param input.actor لقطة الفاعل: اسمه ودوره
 * @param input.branch اسم الفرع العربي والإنجليزي
 * @param input.occurredAt لحظة الفعل
 * @param input.timeZone المنطقة الزمنية الفعّالة للفرع
 * @param input.fallback التسميات البديلة ودالة الاسم الآمن وتسمية الفاعل
 * @returns المعاملات الثمانية بالترتيب، أو null إذا لم يخرج تاريخ أو وقت بصيغتيهما
 */
export function staffAccessNoticeParameters(
  input: StaffAccessNoticeParameterInput,
): StaffAccessNoticeParameters | null {
  const employee = bilingual(
    input.employee.nameAr,
    input.employee.nameEn,
    input.fallback.employee,
    input.fallback.safeName,
  );
  const branch = bilingual(
    input.branch.nameAr,
    input.branch.nameEn,
    input.fallback.branch,
    input.fallback.safeName,
  );
  const actor = {
    ar:
      input.fallback.safeName(input.fallback.actorText('ar', input.actor)) ??
      input.fallback.actor.ar,
    en:
      input.fallback.safeName(input.fallback.actorText('en', input.actor)) ??
      input.fallback.actor.en,
  };
  // منطقة زمنية مخزنة غلط ما تبطلش الوظيفة كلها؛ الجرس بيسقط والاستثناء بيفضل مكتوبًا زي ما هو.
  let date: string;
  let time: string;
  try {
    date = formatLocalDate(input.occurredAt, input.timeZone);
    time = formatLocalShiftStart(input.occurredAt, input.timeZone);
  } catch {
    return null;
  }
  if (!LOCAL_DATE.test(date) || !LOCAL_TIME.test(time)) return null;
  return [
    { name: 'employee_name_ar', type: 'text', value: employee.ar },
    { name: 'employee_name_en', type: 'text', value: employee.en },
    { name: 'actor_name_ar', type: 'text', value: actor.ar },
    { name: 'actor_name_en', type: 'text', value: actor.en },
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'occurred_date', type: 'text', value: date },
    { name: 'occurred_time', type: 'text', value: time },
  ];
}

/**
 * يختار اسماً عربياً وإنجليزياً آمنين؛ الإنجليزي لا يرجع للعربي.
 * النسخة هنا مشتركة مع موديول الطلبات، بس staff ما بيستوردش orders (سهم الـ module-map)،
 * فالقاعدة متكررة هنا في مكان واحد للجرسين.
 *
 * @param nameAr الاسم العربي إن وُجد
 * @param nameEn الاسم الإنجليزي
 * @param fallback التسمية البديلة بالعربية والإنجليزية
 * @param fallback.ar البديل العربي
 * @param fallback.en البديل الإنجليزي
 * @param safeName دالة قبول الاسم الآمن المحقونة
 * @returns الاسمان العربي والإنجليزي بعد الاختيار
 */
function bilingual(
  nameAr: string | null,
  nameEn: string,
  fallback: { readonly ar: string; readonly en: string },
  safeName: (value: string | null) => string | null,
): { readonly ar: string; readonly en: string } {
  return {
    ar: safeName(nameAr) ?? safeName(nameEn) ?? fallback.ar,
    en: safeName(nameEn) ?? fallback.en,
  };
}
