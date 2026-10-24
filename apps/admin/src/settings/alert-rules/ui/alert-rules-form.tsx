'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { setAlertRulesInput, type SetAlertRulesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';
import { listedAlertKinds } from '../model/listed-alert-kinds';
import { AlertRuleRow } from './alert-rule-row';
import { AlertRulesFormStatus, type AlertRulesNotice } from './alert-rules-form-status';
import { useAlertRulesSubmit, type AlertRulesFormProps } from './use-alert-rules-submit';
import { useSyncAlertRulesForm, type AlertRulesReplacement } from './use-sync-alert-rules-form';

export function AlertRulesForm(props: AlertRulesFormProps) {
  const locale = useLocale();
  const [notice, setNotice] = useState<AlertRulesNotice>(null);
  const [replace, setReplace] = useState<AlertRulesReplacement>(null);
  const form = useForm<SetAlertRulesInput>({
    resolver: zodResolver(setAlertRulesInput),
    defaultValues: buildAlertRulesDraft(props.server),
  });
  useSyncAlertRulesForm(form, props.server, replace, setReplace);
  const { save, submit } = useAlertRulesSubmit(props, form, setNotice, setReplace);
  const rows = listedAlertKinds(props.server.rules, props.branchId !== null);
  return (
    <FormProvider {...form}>
      <form
        onSubmit={submit}
        onChange={() => setNotice(null)}
        noValidate
        className="flex flex-col gap-6"
      >
        <fieldset disabled={save.isPending} className="contents">
          {rows.map((rule, index) => (
            <AlertRuleRow
              key={rule.kind}
              companyId={props.companyId}
              userId={props.userId}
              businessId={props.businessId}
              branchId={props.branchId}
              rule={rule}
              index={index}
              disabled={save.isPending}
              onResetDone={() => {
                setReplace({ all: false, kinds: [rule.kind] });
                setNotice('reset');
              }}
              onResetConflict={() => setReplace({ all: false, kinds: [rule.kind] })}
            />
          ))}
        </fieldset>
        {props.branchId !== null ? (
          <p className="text-sm text-muted-foreground">
            {t(locale, 'alertRules.documentExpiryBranchNote')}
          </p>
        ) : null}
        <AlertRulesFormStatus
          invalid={form.formState.isSubmitted && Object.keys(form.formState.errors).length > 0}
          failure={save.isError ? alertRulesFailureMessage(save.error, locale) : null}
          saving={save.isPending}
          notice={notice}
        />
        <Button type="submit" disabled={save.isPending}>
          {t(locale, 'alertRules.save')}
        </Button>
      </form>
    </FormProvider>
  );
}
