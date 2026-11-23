import { useCallback, useRef } from 'react';
import { useBranchServiceCategorySavePending } from '../api/use-branch-service-category-save';

/** زرّ «إضافة تصنيف» الواحد في ترويسة الشاشة: ينفّذ معالج العرض الظاهر، ويتعطل أثناء كتابة جارية في الفرع. */
export type CreateAction = { run: () => void; disabled: boolean };

/**
 * يملك معالج الإنشاء الذي يضعه العرض الظاهر، ويحسب تعطيل الزر من حالة الكتابة نفسها في الرندر نفسه
 * (فلا ينتظر الزر تسجيل العرض)؛ العرض لا يضع هنا إلا هوية معالجه.
 *
 * @param ids      الشركة والنشاط والمستخدم لمفتاح الكتابات الجارية
 * @param branchId الفرع المعروض، أو null لعرض النشاط
 * @returns دالة وضع المعالج للعروض، وإجراء الزر للترويسة
 */
export function useScreenCreateAction(
  ids: { companyId: string; businessId: string; userId: string },
  branchId: string | null,
) {
  const handler = useRef<(() => void) | null>(null);
  const setHandler = useCallback((run: (() => void) | null) => {
    handler.current = run;
  }, []);
  const run = useCallback(() => handler.current?.(), []);
  const saving = useBranchServiceCategorySavePending({ ...ids, branchId: branchId ?? '' });
  const action: CreateAction = { run, disabled: branchId !== null && saving };
  return { setHandler, action };
}
