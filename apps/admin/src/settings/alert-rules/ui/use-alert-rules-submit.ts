'use client';

import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import type { Dispatch, SetStateAction } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useSaveAlertRules } from '../api/use-save-alert-rules';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';
import { alertRulesSaveBody } from '../model/alert-rules-save-body';
import type { AlertRulesNotice } from './alert-rules-form-status';
import type { AlertRulesReplaceRequest } from './use-sync-alert-rules-form';

export type AlertRulesFormProps = {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string | null;
  server: AlertRules;
  /** لحظة آخر قراءة ناجحة لقواعد النطاق ده (تتحرك حتى لو القيم متطابقة). */
  serverUpdatedAt: number;
};

export function useAlertRulesSubmit(
  props: AlertRulesFormProps,
  form: UseFormReturn<SetAlertRulesInput>,
  setNotice: Dispatch<SetStateAction<AlertRulesNotice>>,
  requestReplace: (request: AlertRulesReplaceRequest) => void,
) {
  const save = useSaveAlertRules(
    props.companyId,
    props.userId,
    props.businessId,
    props.branchId,
    () => requestReplace({ all: true, kinds: [] }),
  );
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
    });
  });
  return { save, submit };
}
