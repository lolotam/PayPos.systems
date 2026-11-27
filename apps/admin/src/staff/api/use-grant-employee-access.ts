'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { employeeStaffAccessKey } from './use-employee-staff-access';

/** جسم المنح: الهاتف والتأكيد والدور والرقم السري — ما بيخرجش من الشاشة دي. */
export interface EmployeeAccessGrantBody {
  readonly phone: string;
  readonly phone_confirmed: true;
  readonly role: 'staff' | 'reception';
  readonly pin: string;
  /** إيميل الاستعادة الاختياري؛ غيابه معناه ما يتسجلش حاجة. */
  readonly recovery_email?: string | null | undefined;
}

/** حالة نداء المنح: الانتظار والخطأ والنجاح — كلها في حالة الشاشة مش في كاش. */
export interface EmployeeAccessGrantCall {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly error: unknown;
  /** ينفّذ المنح؛ بيحط الحالة الملتزمة في الكاش بعد ما يوقف أي قراءة قديمة. */
  readonly mutate: (body: EmployeeAccessGrantBody) => Promise<void>;
}

/**
 * منح الدخول: الرد هو الحالة بعد الالتزام، وإعادة المحاولة بعد أي فشل آمنة لأن الطلب مستأنف بمعرّف
 * العملية (FR-F1-6). الطلب نداء مباشر من غير `useMutation`: الـ mutation بيمسك الوسائط (الهاتف
 * والرقم السري) في `variables` من أول الطلب والنتيجة في كاش الـ mutations لحد ما ينضف، فالهاتف
 * والرقم السري ما بيعدوش على غير الدالة اللي نادت. مفيش مفتاح query فيه رقم سري ولا هاتف.
 */
export function useGrantEmployeeAccess(
  companyId: string,
  businessId: string,
  employeeId: string,
): EmployeeAccessGrantCall {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mutate = async (body: EmployeeAccessGrantBody): Promise<void> => {
    setPending(true);
    setFailed(false);
    setSucceeded(false);
    setError(null);
    const { recovery_email: recoveryEmail, ...terms } = body;
    try {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/staff-access',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
          body: { ...terms, ...(recoveryEmail == null ? {} : { recovery_email: recoveryEmail }) },
        },
      );
      if (result.error) throw result.error;
      const key = employeeStaffAccessKey(companyId, businessId, employeeId);
      // أي قراءة قديمة لسه طالعة ما لازمش تكتب فوق الحالة الملتزمة.
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, result.data);
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
