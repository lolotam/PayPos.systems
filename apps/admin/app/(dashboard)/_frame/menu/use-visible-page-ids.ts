'use client';

import { useMemo } from 'react';

import { useWorkspace } from '@/workspace/model/workspace-provider';

import { NAVIGATION_PAGES } from '../navigation-model';
import { useVisibilityConditions } from './use-visibility-conditions';
import { visiblePageIds } from './visible-page-ids';

/**
 * قائمة الصفحات المرئية للمستخدم الحالي. نوع النشاط والبلد غير المعروفين (تحميل أو رد API قديم)
 * يُمرَّران null كما تتوقع isEntryShownForWorkspace، فتختفي المداخل المقيّدة بنوع نشاط فقط.
 */
export function useVisiblePageIds(): readonly string[] {
  const conditions = useVisibilityConditions();
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const businessType = ready?.business?.business_type ?? null;
  const country = ready?.business?.country ?? null;
  const role = ready?.company.role_code ?? '';
  return useMemo(
    () => visiblePageIds(NAVIGATION_PAGES, { conditions, businessType, country, role }),
    [conditions, businessType, country, role],
  );
}
