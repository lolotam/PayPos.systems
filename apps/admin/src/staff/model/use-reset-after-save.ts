'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';

/** بعد حفظ ناجح يرجع النموذج لقيمه الأولية ويقف المؤشر على أول حقل ليبدأ إدخال الموظفة التالية. */
export function useResetAfterSave(form: UseFormReturn<CreateEmployeeInput>, saved: unknown): void {
  useEffect(() => {
    if (!saved) return undefined;
    form.reset();
    // التفريغ بيعيد تسجيل الحقول بعد الرسم؛ التركيز في نفس اللحظة كان بيضيع.
    const frame = requestAnimationFrame(() => form.setFocus('name_en'));
    return () => cancelAnimationFrame(frame);
  }, [saved, form]);
}
