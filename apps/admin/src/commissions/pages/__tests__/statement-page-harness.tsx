import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Mock } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { COMPANY, USER, type ApiAnswer } from '../../api/__tests__/plan-http';
import { BUSINESS_ID } from '../../api/__tests__/statement-http';
import { CommissionStatementPage } from '../commission-statement-page';

/** مزيّف عميل الـ API: كل ملف اختبار بيعرّفه بـ vi.hoisted ويركّبه بـ vi.mock على عميل الأدمن. */
export interface ApiMock {
  GET: Mock;
  POST: Mock;
}

/** يركّب الصفحة بعميل استعلامات جديد، ويرجّع نتيجة render. */
export function renderStatementPage() {
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <CommissionStatementPage companyId={COMPANY} userId={USER} businessId={BUSINESS_ID} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** القراءة بترجّع الرد الحالي المتغيّر من الاختبار نفسه، عشان القراءة بعد الأمر تشوف الحالة الجديدة. */
export function serveReading(api: ApiMock, current: { answer: ApiAnswer }) {
  api.GET.mockImplementation(async () => current.answer);
}
