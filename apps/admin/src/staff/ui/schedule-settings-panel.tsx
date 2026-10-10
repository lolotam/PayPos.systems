'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setScheduleSettingsInput, type SetScheduleSettingsInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import {
  useScheduleSettings,
  useSetScheduleSettings,
  useSetBranchScheduleSettings,
  useClearBranchScheduleSettings,
  useScheduleWorkspaceBranches,
} from '../api/use-schedule-settings';
import type { ScheduleWorkspace } from '../api/use-schedules';

function useSettingsPanel(scope: ScheduleWorkspace) {
  const locale = useLocale();
  const query = useScheduleSettings(scope);
  const save = useSetScheduleSettings(scope);
  const saveBranch = useSetBranchScheduleSettings(scope);
  const clearBranch = useClearBranchScheduleSettings(scope);
  const branches = useScheduleWorkspaceBranches(scope);
  const branch = query.data?.branches?.find((b) => b.branch_id === scope.branchId);
  const branchForm = useForm<SetScheduleSettingsInput>({
    resolver: zodResolver(setScheduleSettingsInput),
    values: { max_shifts_per_day: branch?.max_shifts_per_day ?? 3 },
  });
  const form = useForm<SetScheduleSettingsInput>({
    resolver: zodResolver(setScheduleSettingsInput),
    values: { max_shifts_per_day: query.data?.max_shifts_per_day ?? 3 },
  });
  return { locale, query, save, saveBranch, clearBranch, branches, branch, branchForm, form };
}
type PanelState = ReturnType<typeof useSettingsPanel>;
export function ScheduleSettingsPanel({ scope }: { scope: ScheduleWorkspace }) {
  const state = useSettingsPanel(scope);
  const { query, locale } = state;
  if (query.isError) {
    if (
      typeof query.error === 'object' &&
      query.error !== null &&
      'code' in query.error &&
      (query.error.code === 'FORBIDDEN' || query.error.code === 'NOT_FOUND')
    )
      return null;
    return <p role="alert">{envelopeMessage(query.error, locale)}</p>;
  }
  if (!query.data) return null;
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border p-4 text-start">
      {renderBusinessForm(state)}
      {renderBranchForm(state)}
      {renderBranchList(state)}
    </section>
  );
}
function renderBusinessForm({ locale, query, save, form }: PanelState) {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit(async (input) => {
        try {
          await save.mutateAsync(input);
        } catch {
          /* الرسالة الثنائية تأتي من حالة الطلب أدناه. */
        }
      })}
    >
      <h2 className="text-lg font-semibold">{t(locale, 'shell.schedule_settings_title')}</h2>
      {query.data?.is_default ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'shell.schedule_settings_default')}
        </p>
      ) : null}
      <Label htmlFor="schedule-max-shifts">{t(locale, 'shell.schedule_settings_limit')}</Label>
      <Input
        id="schedule-max-shifts"
        type="number"
        min={1}
        max={4}
        step={1}
        disabled={save.isPending}
        {...form.register('max_shifts_per_day', { valueAsNumber: true })}
      />
      {form.formState.errors.max_shifts_per_day ? (
        <p role="alert">{t(locale, 'errors.VALIDATION_FAILED')}</p>
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      <Button type="submit" disabled={save.isPending}>
        {t(locale, 'shell.schedule_settings_save')}
      </Button>
    </form>
  );
}
function renderBranchForm({ locale, branch, branchForm, saveBranch, clearBranch }: PanelState) {
  return branch ? (
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
  ) : null;
}
function renderBranchList({ locale, query, branches }: PanelState) {
  return (
    <>
      <h3 className="font-semibold">{t(locale, 'shell.schedule_settings_branches')}</h3>
      <ul className="flex flex-col gap-2">
        {query.data?.branches?.map((item) => {
          const name = branches.find((b) => b.id === item.branch_id);
          return (
            <li key={item.branch_id} className="flex flex-wrap items-center gap-2">
              <span>
                {(locale === 'ar' ? (name?.name_ar ?? name?.name_en) : name?.name_en) ??
                  item.branch_id}
              </span>
              <span>{item.max_shifts_per_day}</span>
              <span className="text-sm text-muted-foreground">
                {t(locale, `shell.schedule_settings_source_${item.source}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
function renderBranchFields({
  locale,
  branchForm,
  saveBranch,
  clearBranch,
}: Pick<PanelState, 'locale' | 'branchForm' | 'saveBranch' | 'clearBranch'>) {
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
