'use client';

import { t } from '@pospay/i18n';
import type { InviteMemberInput } from '@pospay/contracts';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { INVITABLE_ROLE_OPTIONS, type InvitationScopeChoices } from '../model/invitable-roles';

/** الدور ونطاقه: اختيار الدور بيمسح النطاق المختار، والنطاق بيظهر بس للأدوار اللي بيطلبه (IM-Q2). */
export function InvitationRoleScopeFields({ choices }: { choices: InvitationScopeChoices }) {
  const locale = useLocale();
  const form = useFormContext<InviteMemberInput>();
  const role = form.watch('role');
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  const options =
    option?.scopeType === 'BUSINESS'
      ? choices.businesses
      : option?.scopeType === 'BRANCH'
        ? choices.branches
        : [];
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t(locale, 'invitations.roleLabel')}</span>
        <select
          {...form.register('role', { onChange: () => form.setValue('scope.id', '') })}
          className="w-full rounded-md border bg-background px-3 py-2"
        >
          {INVITABLE_ROLE_OPTIONS.map((candidate) => (
            <option key={candidate.role} value={candidate.role}>
              {t(locale, candidate.labelKey)}
            </option>
          ))}
        </select>
      </label>
      {option?.scopeType !== 'COMPANY' ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t(locale, 'invitations.scopeLabel')}</span>
          <select
            required
            {...form.register('scope.id')}
            className="w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="" disabled>
              {t(locale, 'permissions.choose')}
            </option>
            {options.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-muted-foreground">{t(locale, 'invitations.scopeCompany')}</p>
      )}
    </>
  );
}
