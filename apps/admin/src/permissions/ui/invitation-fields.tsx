'use client';

import type { InviteMemberInput } from '@pospay/contracts';
import { useFormContext } from 'react-hook-form';

import { InvitationConfirmFields } from './invitation-confirm-fields';
import { InvitationRoleScopeFields } from './invitation-role-scope-fields';
import type { InvitationScopeChoices } from '../model/invitable-roles';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** حقول الدعوة: الإيميل بيمسح التأكيد لو اتغير، والدور ونطاقه، وكتلة التأكيد الإجبارية (D10). */
export function InvitationFields({ choices }: { choices: InvitationScopeChoices }) {
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
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t(locale, 'invitations.nameLabel')}</span>
        <input
          required
          {...form.register('name')}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
      </label>
      <InvitationRoleScopeFields choices={choices} />
      <InvitationConfirmFields />
    </>
  );
}
