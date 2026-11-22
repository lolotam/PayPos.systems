'use client';
import type { RecordingDiscountLimit } from '@pospay/contracts';
import { PageShell } from '@pospay/ui';
import { useState, type ReactNode } from 'react';
import { FormProvider, type UseFormReturn } from 'react-hook-form';
import type { SessionDraftForm } from '../model/session-drafts';
import { SessionDraftSummary } from './session-draft-summary';

// الملخص يقرأ المسودة من سياق النموذج، فالمزوّد يلف العمودين معًا؛ والحد المعتمد يصعد من حقل المسجِّلة
// إلى هنا ليرسمه الملخص في العمود الجانبي الذي يثبت أثناء تمرير النموذج من 1024px.
export function RecordVisitColumns({ form, top, main }: {
  form: UseFormReturn<SessionDraftForm>;
  top?: ReactNode;
  main: (onLimitChange: (limit: RecordingDiscountLimit | null) => void) => ReactNode;
}) {
  const [limit, setLimit] = useState<RecordingDiscountLimit | null>(null);
  return <FormProvider {...form}>
    <PageShell layout="two-column" main={main(setLimit)} side={<div className="lg:sticky lg:top-4"><SessionDraftSummary limit={limit} /></div>}>{top}</PageShell>
  </FormProvider>;
}
