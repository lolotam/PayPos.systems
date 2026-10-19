'use client';
import { employeeNumberPage, employeeNumberView, type EmployeeNumberPage } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { newlyMatches, withSavedNumber } from '../model/company-numbers-saved-page';

const listKey = (companyId: string, userId: string) =>
  ['employee-numbers', companyId, userId, 'list'] as const;
const listKeyLength = 4;

async function readPage(
  companyId: string,
  cursor: string | undefined,
  q: string | undefined,
  signal: AbortSignal,
) {
  const result = await apiClient().GET('/v1/employee-numbers', {
    params: {
      header: { 'x-company-id': companyId },
      query: { limit: 20, ...(cursor ? { cursor } : {}), ...(q ? { q } : {}) },
    },
    signal,
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return employeeNumberPage.parse(result.data);
}

async function writeNumber(
  companyId: string,
  businessId: string,
  employeeId: string,
  employeeNumber: number,
) {
  const result = await apiClient().PUT(
    '/v1/businesses/{businessId}/employees/{employeeId}/employee-number',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } },
      body: { employee_number: employeeNumber },
    },
  );
  if (result.error) throw { ...result.error, status: result.response.status };
  return employeeNumberView.parse(result.data);
}

export function useCompanyEmployeeNumbers(
  companyId: string,
  userId: string,
  cursor?: string,
  q?: string,
) {
  // المفتاح يشمل المستخدم لأن المنع DENY بيتفلتر لكل صاحب صلاحية لوحده (PP-3.1).
  return useQuery({
    queryKey: [...listKey(companyId, userId), cursor ?? null, q ?? null],
    queryFn: ({ signal }) => readPage(companyId, cursor, q, signal),
    retry: false,
  });
}

export function useSetCompanyEmployeeNumber(companyId: string, userId: string) {
  const client = useQueryClient();
  const key = listKey(companyId, userId);
  return useMutation({
    retry: false,
    mutationFn: (input: { businessId: string; employeeId: string; employeeNumber: number }) =>
      writeNumber(companyId, input.businessId, input.employeeId, input.employeeNumber),
    onError: (error) => {
      // الرفض بالصلاحية معناه إن الصف ممكن مابقاش مسموح يظهر؛ القائمة بتتجاب تاني من السيرفر.
      const status = (error as { status?: unknown }).status;
      if (status !== 403 && status !== 404) return;
      client.removeQueries({ queryKey: [...key], type: 'inactive' });
      void client.invalidateQueries({ queryKey: [...key] });
    },
    onSuccess: (saved) => {
      // كل صفحة بتتحدّث بالبحث بتاعها: صفحة البحث بالرقم بتطلّع الصف لو الرقم الجديد مابقاش مطابق.
      for (const [queryKey, page] of client.getQueriesData<EmployeeNumberPage>({
        queryKey: [...key],
      })) {
        if (!page) continue;
        const q = (queryKey[listKeyLength + 1] ?? null) as string | null;
        client.setQueryData(
          queryKey,
          withSavedNumber(page, q, saved.employee_id, saved.employee_number),
        );
        // بحث بالرقم الجديد مكانش فيه الصف؛ النسخة دي بتتشال عشان أول فتح يجيبه.
        if (newlyMatches(page, q, saved.employee_id, saved.employee_number)) {
          client.removeQueries({ queryKey, exact: true, type: 'inactive' });
        }
      }
      // انتظار الـ refetch كان بيخلّي الحفظ معلّق والمحرّر مفتوح لو القائمة اتعلّقت.
      void client.invalidateQueries({ queryKey: [...key] });
      // نسخ قايمة الموظفين وملف الموظف واختيار المؤدية المقفولة بتتشال، فأول فتح بيجيب الرقم الجديد بدل القديم.
      for (const prefix of ['employees', 'session-performers', 'session-performer-facts']) {
        client.removeQueries({ queryKey: [prefix, companyId], type: 'inactive' });
        void client.invalidateQueries({ queryKey: [prefix, companyId] });
      }
    },
  });
}
