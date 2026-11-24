'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  setScheduleSettingsInput,
  type BranchScheduleSettings,
  type SetScheduleSettingsInput,
} from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import {
  useClearBranchScheduleSettings,
  useSetBranchScheduleSettings,
} from '../api/use-schedule-settings';
import type { ScheduleWorkspace } from '../api/use-schedules';

export type BranchSetting = BranchScheduleSettings;

// النموذج ده وحده ومفتاحه الفرع، عشان رقم مكتوب لفرع ما ينحفظش على فرع تاني.
export function ScheduleSettingsBranchForm({
  scope,
  branch,
}: {
  scope: ScheduleWorkspace;
  branch: BranchSetting;
}) {
  const locale = useLocale();
  const saveBranch = useSetBranchScheduleSettings(scope);
  const clearBranch = useClearBranchScheduleSettings(scope);
  const branchForm = useForm<SetScheduleSettingsInput>({
    resolver: zodResolver(setScheduleSettingsInput),
    values: { max_shifts_per_day: branch.max_shifts_per_day },
  });
  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={branchForm.handleSubmit(async (input) => {
        try {
          await saveBranch.mutateAsync(input);
        } catch {
          /* حالة الطلب تعرض الرفض. */
        }
      })}
    >
      <p>
        {t(locale, 'shell.schedule_settings_effective').replace(
          '{limit}',
          String(branch.max_shifts_per_day),
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {t(locale, `shell.schedule_settings_source_${branch.source}`)}
      </p>
      {renderBranchFields({ locale, branchForm, saveBranch, clearBranch })}
      <Button type="submit" disabled={saveBranch.isPending || clearBranch.isPending}>
        {t(locale, 'shell.schedule_settings_branch_save')}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={saveBranch.isPending || clearBranch.isPending || branch.source !== 'branch'}
        onClick={() => {
          void clearBranch.mutateAsync().catch(() => undefined);
        }}
      >
        {t(locale, 'shell.schedule_settings_inherit')}
      </Button>
    </form>
  );
}
function renderBranchFields({
  locale,
  branchForm,
  saveBranch,
  clearBranch,
}: {
  locale: Locale;
  branchForm: UseFormReturn<SetScheduleSettingsInput>;
  saveBranch: ReturnType<typeof useSetBranchScheduleSettings>;
  clearBranch: ReturnType<typeof useClearBranchScheduleSettings>;
}) {
  return (
    <>
      <Label htmlFor="branch-max-shifts">{t(locale, 'shell.schedule_settings_branch_limit')}</Label>
      <Input
        id="branch-max-shifts"
        type="number"
        min={1}
        max={4}
        step={1}
        disabled={saveBranch.isPending || clearBranch.isPending}
        {...branchForm.register('max_shifts_per_day', { valueAsNumber: true })}
      />
      {branchForm.formState.errors.max_shifts_per_day ? (
        <p role="alert">{t(locale, 'errors.VALIDATION_FAILED')}</p>
      ) : null}
      {saveBranch.isError ? <p role="alert">{envelopeMessage(saveBranch.error, locale)}</p> : null}
      {clearBranch.isError ? (
        <p role="alert">{envelopeMessage(clearBranch.error, locale)}</p>
      ) : null}
    </>
  );
}
