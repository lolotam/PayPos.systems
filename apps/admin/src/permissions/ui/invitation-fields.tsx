'use client';

import type { InviteMemberInput } from '@pospay/contracts';
import { useFormContext } from 'react-hook-form';

import { InvitationConfirmFields } from './invitation-confirm-fields';
import { InvitationExtraRolesFields } from './invitation-extra-roles-fields';
import { InvitationInlineOverrides } from './invitation-inline-overrides';
import { InvitationMultiScopeFields } from './invitation-multi-scope-fields';
import { InvitationRoleScopeFields } from './invitation-role-scope-fields';
import type { InvitationScopeChoices } from '../model/invitable-roles';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** حقول الدعوة: الإيميل بيمسح التأكيد لو اتغير، والدور ونطاقه، وكتلة التأكيد الإجبارية (D10). */
export function InvitationFields({
  choices,
  companyId,
}: {
  choices: InvitationScopeChoices;
  companyId: string;
}) {
  const locale = useLocale();
  const form = useFormContext<InviteMemberInput>();
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t(locale, 'invitations.emailLabel')}</span>
        <input
          type="email"
          required
          {...form.register('email', {
            onChange: () => form.setValue('email_confirmed', false as unknown as true),
          })}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
      </label>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t(locale, 'invitations.nameLabel')}</span>
          <input
            required
            {...form.register('name')}
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={form.formState.errors.name ? 'invitation-name-error' : undefined}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </label>
        {form.formState.errors.name ? (
          <p id="invitation-name-error" role="alert" className="text-sm text-destructive">
            {t(locale, 'invitations.nameRequired')}
          </p>
        ) : null}
      </div>
      <InvitationRoleScopeFields choices={choices} companyId={companyId} />
      <InvitationMultiScopeFields choices={choices} />
      <InvitationExtraRolesFields choices={choices} companyId={companyId} />
      <InvitationInlineOverrides choices={choices} companyId={companyId} />
      <InvitationConfirmFields />
    </>
  );
}
