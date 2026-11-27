'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { setAlertRulesInput, type SetAlertRulesInput } from '@pospay/contracts';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';
import type { AlertRulesNotice } from './alert-rules-form-status';
import { useAlertRulesSubmit, type AlertRulesFormProps } from './use-alert-rules-submit';
import { useSyncAlertRulesForm, type AlertRulesReplaceRequest } from './use-sync-alert-rules-form';

/** نموذج القواعد مع المزامنة والحفظ والإشعار، عشان مكوّن النموذج يفضل للعرض بس. */
export function useAlertRulesFormState(props: AlertRulesFormProps) {
  const [notice, setNotice] = useState<AlertRulesNotice>(null);
  const form = useForm<SetAlertRulesInput>({
    resolver: zodResolver(setAlertRulesInput),
    defaultValues: buildAlertRulesDraft(props.server),
  });
  const onApplied = useCallback((request: AlertRulesReplaceRequest) => {
    if (request.notice) setNotice(request.notice);
  }, []);
  const { requestReplace } = useSyncAlertRulesForm(
    form,
    props.server,
    props.serverUpdatedAt,
    onApplied,
  );
  const { save, submit } = useAlertRulesSubmit(props, form, setNotice, requestReplace);
  return { form, notice, setNotice, requestReplace, save, submit };
}
