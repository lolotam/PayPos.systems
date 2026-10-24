'use client';

import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import type { Dispatch, SetStateAction } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useSaveAlertRules } from '../api/use-save-alert-rules';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';
import { alertRulesSaveBody } from '../model/alert-rules-save-body';
import type { AlertRulesNotice } from './alert-rules-form-status';

export type AlertRulesFormProps = {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string | null;
  server: AlertRules;
};

export function useAlertRulesSubmit(
  props: AlertRulesFormProps,
  form: UseFormReturn<SetAlertRulesInput>,
  setNotice: Dispatch<SetStateAction<AlertRulesNotice>>,
) {
  const save = useSaveAlertRules(props.companyId, props.userId, props.businessId, props.branchId);
  const submit = form.handleSubmit((data) => {
    setNotice(null);
    const body = alertRulesSaveBody(props.server, data);
    if (body === null) {
      setNotice('nothing');
      return;
    }
    save.mutate(body, {
      onSuccess: (stored) => {
        form.reset(buildAlertRulesDraft(stored));
        setNotice('saved');
      },
      onError: (error) => {
        if (typeof error === 'object' && error !== null && 'status' in error && error.status === 409) {
          form.reset(buildAlertRulesDraft(props.server));
        }
      },
    });
  });
  return { save, submit };
}
