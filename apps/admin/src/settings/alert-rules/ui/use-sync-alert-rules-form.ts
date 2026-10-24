'use client';

import type { AlertKindCode, AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';

type AlertRulesForm = UseFormReturn<SetAlertRulesInput>;
export type AlertRulesReplacement = {
  all: boolean;
  kinds: readonly AlertKindCode[];
} | null;

export function useSyncAlertRulesForm(
  form: AlertRulesForm,
  server: AlertRules,
  replace: AlertRulesReplacement,
  setReplace: Dispatch<SetStateAction<AlertRulesReplacement>>,
) {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const draft = buildAlertRulesDraft(server);
    const next = JSON.stringify(draft);
    if (replace === null && seen.current === next) return;
    const replaceAll = replace?.all === true;
    const resetKinds = new Set(replace?.kinds ?? []);
    const kept = replaceAll
      ? []
      : draft.rules.flatMap((entry, index) =>
          !resetKinds.has(entry.kind) && form.getFieldState(`rules.${index}`).isDirty
            ? [{ index, value: form.getValues(`rules.${index}`) }]
            : [],
        );
    form.reset(draft);
    for (const entry of kept) {
      form.setValue(`rules.${entry.index}`, entry.value, { shouldDirty: true });
    }
    // الاستبدال state لأن structural sharing ممكن يثبّت server؛ وتسجيله بعد نجاح refetchQueries
    // يضمن أن القيم الحالية هي الأحدث حتى لو كانت مساوية للكاش وما غيّرش مرجعه.
    if (replace !== null) setReplace(null);
    seen.current = next;
  }, [form, replace, server, setReplace]);
}
