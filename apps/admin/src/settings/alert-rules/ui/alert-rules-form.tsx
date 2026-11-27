'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useAlertRulesWriting } from '../api/use-alert-rules-writing';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';
import { listedAlertKinds } from '../model/listed-alert-kinds';
import { AlertRuleRow } from './alert-rule-row';
import { AlertRulesFormStatus } from './alert-rules-form-status';
import type { AlertRulesFormProps } from './use-alert-rules-submit';
import { useAlertRulesFormState } from './use-alert-rules-form-state';

export function AlertRulesForm(props: AlertRulesFormProps) {
  const locale = useLocale();
  const writing = useAlertRulesWriting(props.companyId, props.userId, props.businessId);
  const { form, notice, setNotice, requestReplace, save, submit } = useAlertRulesFormState(props);
  const rows = listedAlertKinds(props.server.rules, props.branchId !== null);
  return (
    <FormProvider {...form}>
      <form
        onSubmit={submit}
        onChange={() => setNotice(null)}
        noValidate
        className="flex flex-col gap-6"
      >
        <fieldset disabled={writing} className="contents">
          {rows.map((rule, index) => (
            <AlertRuleRow
              key={rule.kind}
              companyId={props.companyId}
              userId={props.userId}
              businessId={props.businessId}
              branchId={props.branchId}
              rule={rule}
              index={index}
              disabled={writing}
              onResetDone={() =>
                requestReplace({ all: false, kinds: [rule.kind], notice: 'reset' })
              }
              onResetConflict={(options) =>
                requestReplace({ all: false, kinds: [rule.kind], ...options })
              }
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
        <Button type="submit" disabled={writing}>
          {t(locale, 'alertRules.save')}
        </Button>
      </form>
    </FormProvider>
  );
}
