'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { employeeStaffAccessKey } from './use-employee-staff-access';

/** جسم تغيير الهاتف: الهاتف الجديد والتأكيد والرقم السري المؤقت — ما بيخرجش من الشاشة دي. */
export interface EmployeeStaffPhoneChangeBody {
  readonly phone: string;
  readonly phone_confirmed: true;
  readonly pin: string;
}

/** حالة نداء تغيير الهاتف: الانتظار والخطأ والنجاح — كلها في حالة الشاشة مش في كاش. */
export interface EmployeeStaffPhoneChangeCall {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly error: unknown;
  /** ينفّذ التغيير؛ بيحط الحالة الملتزمة في الكاش بعد ما يوقف أي قراءة قديمة. */
  readonly mutate: (body: EmployeeStaffPhoneChangeBody) => Promise<void>;
}

/**
 * تغيير هاتف الموظفة: الرد هو الحالة بعد الالتزام، وإعادة المحاولة بعد أي فشل آمنة لأن الطلب مستأنف
 * على سجل الدخول (F3-1). الطلب نداء مباشر من غير `useMutation`: الـ mutation بيمسك الوسائط (الهاتف
 * والرقم السري) في `variables` من أول الطلب والنتيجة في كاش الـ mutations، فالهاتف والرقم السري ما
 * بيعدوش على غير الدالة اللي نادت. مفيش مفتاح query فيه رقم سري ولا هاتف.
 */
export function useChangeEmployeeStaffPhone(
  companyId: string,
  businessId: string,
  employeeId: string,
): EmployeeStaffPhoneChangeCall {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mutate = async (body: EmployeeStaffPhoneChangeBody): Promise<void> => {
    setPending(true);
    setFailed(false);
    setSucceeded(false);
    setError(null);
    try {
      const result = await apiClient().PUT(
        '/v1/businesses/{businessId}/employees/{employeeId}/staff-access/phone',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
          },
          body,
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
