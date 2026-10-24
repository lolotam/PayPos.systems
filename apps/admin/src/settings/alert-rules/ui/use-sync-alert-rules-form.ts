'use client';

import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import { useEffect, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';

type AlertRulesForm = UseFormReturn<SetAlertRulesInput>;

export function useSyncAlertRulesForm(form: AlertRulesForm, server: AlertRules) {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const draft = buildAlertRulesDraft(server);
    const next = JSON.stringify(draft);
    if (seen.current === next) return;
    seen.current = next;
    form.reset(draft, { keepDirtyValues: true });
  }, [form, server]);
}
