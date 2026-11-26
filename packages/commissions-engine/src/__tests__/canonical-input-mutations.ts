import type { FieldMutation } from './canonical-input-mutation-editor.ts';
import { adjustmentMutations } from './canonical-input-mutations-adjustments.ts';
import { lineMutations, saleTipSalaryMutations } from './canonical-input-mutations-sales.ts';
import { noorPlanMutations, saraPlanMutations } from './canonical-input-mutations-plans.ts';
import type { StatementMonthRows } from './statement-fixtures.ts';

export type { FieldMutation };

/**
 * كل حقل بتبصمه بصمة المدخلات، تعديله لوحده (وللقاعدة أكتر من تعديل بين نوع بقيمة وبلا قيمة).
 * اختبار اكتمال القايمة بيقارن حقولها بأوراق القيمة المكتوبة بإيدي (ما عدا `period` وله اختباره)،
 * فحقل اتشال من المنشئ بيفضل له تعديل هنا ويفشل الاختبار.
 *
 * @returns التعديلات
 */
export function canonicalMutations(): FieldMutation[] {
  return [
    ...lineMutations(),
    ...saleTipSalaryMutations(),
    ...saraPlanMutations(),
    ...noorPlanMutations(),
    ...adjustmentMutations(),
  ];
}

/**
 * يعيد ترتيب كل قايمة بحيث صفوف الموظفتين تتداخل (الفردي الأول ثم الزوجي)، عشان يثبت إن البناء
 * بعد التجميع بالموظفة مش بيعتمد على ترتيب الإدخال.
 *
 * @param rows صفوف الشهر
 * @returns نفس الصفوف بترتيب مختلف
 */
export function interleaved(rows: StatementMonthRows): StatementMonthRows {
  const reorder = <T>(list: readonly T[]): T[] => [
    ...list.filter((_item, index) => index % 2 === 1),
    ...list.filter((_item, index) => index % 2 === 0),
  ];
  return {
    lines: reorder(rows.lines),
    sales: reorder(rows.sales),
    tips: reorder(rows.tips),
    salaries: reorder(rows.salaries),
    versions: reorder(rows.versions),
    overrides: reorder(rows.overrides),
    corrections: reorder(rows.corrections),
    blocked: reorder(rows.blocked),
    carries: reorder(rows.carries),
  };
}

/**
 * يعكس كل قايمة بالكامل، فأي زوج متعادل في الهوية (زي تصحيحين لنفس المصدر بجيل 9 و10) بيتغذّى
 * بالعكس.
 *
 * @param rows صفوف الشهر
 * @returns نفس الصفوف بترتيب معكوس
 */
export function reversed(rows: StatementMonthRows): StatementMonthRows {
  return {
    lines: [...rows.lines].reverse(),
    sales: [...rows.sales].reverse(),
    tips: [...rows.tips].reverse(),
    salaries: [...rows.salaries].reverse(),
    versions: [...rows.versions].reverse(),
    overrides: [...rows.overrides].reverse(),
    corrections: [...rows.corrections].reverse(),
    blocked: [...rows.blocked].reverse(),
    carries: [...rows.carries].reverse(),
  };
}
