'use client';
import { useState } from 'react';
import { apiClient } from '@/shared/api/client';

/** جسم إعادة الضبط: الرقم السري الجديد بس — ما بيخرجش من الشاشة دي. */
export interface EmployeeStaffPinResetBody {
  readonly pin: string;
}

/** حالة نداء إعادة الضبط: الانتظار والخطأ والنجاح — كلها في حالة الشاشة مش في كاش. */
export interface EmployeeStaffPinResetCall {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly error: unknown;
  /** ينفّذ إعادة الضبط؛ الرد هو الحالة بعد الالتزام. */
  readonly mutate: (body: EmployeeStaffPinResetBody) => Promise<void>;
}

/**
 * إعادة ضبط الرقم السري: الطلب نداء مباشر من غير `useMutation` — الـ mutation بيمسك الوسائط
 * (الرقم السري) في `variables` من أول الطلب، فمفيش query ولا mutation cache فيه رقم سري.
 * حالة الدخول مش بتتغيّر (السجل بيفضل ACTIVE بنفس الدور والفرع والهاتف)، فمفيش داعي نكتب في
 * كاش الاستعلام — والكتابة فيه كانت هتمسح آخر ثلاثة أرقام من الهاتف.
 */
export function useResetEmployeeStaffPin(
  companyId: string,
  businessId: string,
  employeeId: string,
): EmployeeStaffPinResetCall {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mutate = async (body: EmployeeStaffPinResetBody): Promise<void> => {
    setPending(true);
    setFailed(false);
    setSucceeded(false);
    setError(null);
    try {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/staff-access/pin',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
          body,
        },
      );
      if (result.error) throw result.error;
      setSucceeded(true);
    } catch (failure) {
      setFailed(true);
      setError(failure);
    } finally {
      setPending(false);
    }
  };
  return { isPending: pending, isError: failed, isSuccess: succeeded, error, mutate };
}
