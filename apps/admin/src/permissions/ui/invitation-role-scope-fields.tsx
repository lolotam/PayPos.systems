'use client';

import { t } from '@pospay/i18n';
import type { InviteMemberInput } from '@pospay/contracts';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  INVITABLE_ROLE_OPTIONS,
  scopeForRole,
  type InvitationScopeChoices,
} from '../model/invitable-roles';

/**
 * الدور ونطاقه: تغيير الدور بيكتب النطاق كله من جديد — نوعه من الدور، ومعرّفه معرّف الشركة للأدوار
 * اللي نطاقها الشركة أو فاضي لحد ما المالك يختار نشاط أو فرع. النطاق بيتعرض للاختيار بس للأدوار
 * اللي محتاجاه.
 */
export function InvitationRoleScopeFields({
  choices,
  companyId,
}: {
  choices: InvitationScopeChoices;
  companyId: string;
}) {
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
          {...form.register('role', {
            onChange: (event: { target: { value: string } }) =>
              form.setValue('scope', scopeForRole(event.target.value, companyId)),
          })}
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
