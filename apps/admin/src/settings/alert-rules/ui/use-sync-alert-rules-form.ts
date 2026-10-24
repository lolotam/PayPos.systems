'use client';

import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import { useEffect, useRef, type RefObject } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';

type AlertRulesForm = UseFormReturn<SetAlertRulesInput>;

export function useSyncAlertRulesForm(
  form: AlertRulesForm,
  server: AlertRules,
  replaceDraft: RefObject<boolean>,
) {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const draft = buildAlertRulesDraft(server);
    const next = JSON.stringify(draft);
    const replaceAll = replaceDraft.current;
    if (seen.current === next && !replaceAll) return;
    const kept = replaceAll
      ? []
      : draft.rules.flatMap((_entry, index) =>
          form.getFieldState(`rules.${index}`).isDirty
            ? [{ index, value: form.getValues(`rules.${index}`) }]
            : [],
        );
    form.reset(draft);
    for (const entry of kept) {
      form.setValue(`rules.${entry.index}`, entry.value, { shouldDirty: true });
    }
    // القاعدة المتغيّرة تحتفظ بقراءتها القديمة كاملة، عشان الحفظ يكشف تعارض النسخة بدل ما يكتب فوق مدير تاني.
    replaceDraft.current = false;
    seen.current = next;
  }, [form, replaceDraft, server]);
}
