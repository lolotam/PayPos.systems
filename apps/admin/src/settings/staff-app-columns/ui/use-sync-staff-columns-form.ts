'use client';

import type { ReplaceStaffColumnsInput, StaffColumnsSettings } from '@pospay/contracts';
import { useEffect, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { StaffColumnsDraft } from '../model/staff-columns-save-body';

type StaffColumnsForm = UseFormReturn<StaffColumnsDraft, unknown, ReplaceStaffColumnsInput>;

/** الأعمدة مجموعة مش ترتيب، فبالمقارنة بين إعدادين بنستخدم الأكواد نفسها. */
function fingerprint(server: StaffColumnsSettings): string {
  return JSON.stringify({
    columns: [...new Set(server.columns)].sort(),
    columns_default: server.columns_default,
    months_back: server.months_back,
    months_back_default: server.months_back_default,
  });
}

/**
 * يربط الفورم بإعداد السيرفر لما يتغير من غير ما يمسح مسودة المستخدم.
 * السبب: القراءة بتتحدّث لوحدها (نافذة تانية، إعادة محاولة بعد رفض)، والإعداد القديم ممكن يكون اتغيّر من مدير تاني.
 */
export function useSyncStaffColumnsForm(form: StaffColumnsForm, server: StaffColumnsSettings) {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const next = fingerprint(server);
    if (seen.current === next) return;
    seen.current = next;
    // الحقول اللي المستخدم مالمسّهاش بتاخد الجديد، واللي بيشتغل عليها بتفضل مسودته.
    form.reset(
      { columns: [...server.columns], months_back: server.months_back },
      { keepDirtyValues: true },
    );
  }, [form, server]);
}
