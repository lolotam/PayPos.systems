'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { inviteMemberInput, type InviteMemberInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { INVITABLE_ROLE_OPTIONS, invitationPayload } from '../model/invitable-roles';
import { InvitationFields } from './invitation-fields';
import type { InvitationScopeChoices } from '../model/invitable-roles';

// شكل النموذج هو عقد الطلب نفسه؛ علامة التأكيد بتبدأ شالها والـ resolver بيرفض أي إرسال من غيرها (D10).
type InvitationFormValues = InviteMemberInput;

type Props = {
  companyId: string;
  choices: InvitationScopeChoices;
  disabled: boolean;
  pending: boolean;
  onSave: (input: InviteMemberInput) => void;
};

/** بنموذج الدعوة: الإيميل كامل بيتعرض قبل الإرسال والتأكيد إجباري دايماً (D10) — مفيش مسار بحث بيفرّق بين حساب موجود وأصلي. */
export function InvitationForm({ companyId, choices, disabled, pending, onSave }: Props) {
  const locale = useLocale();
  const form = useForm<InvitationFormValues, unknown, InviteMemberInput>({
    resolver: zodResolver(inviteMemberInput),
    // الواقع في الشاشة: العلامة شالها في البداية؛ النوع بيطلع true حرفياً فبنخفي الحقيقة دي عن النوع بس.
    defaultValues: {
      email: '',
      name: '',
      role: 'accountant',
      scope: { type: 'COMPANY', id: companyId },
      email_confirmed: false as unknown as true,
      additional_roles: [],
      permission_overrides: [],
    },
  });
  const confirmed = form.watch('email_confirmed') as unknown as boolean;
  const role = form.watch('role');
  const scopeId = form.watch('scope.id');
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  const scopeReady = option?.scopeType === 'COMPANY' || scopeId !== '';
  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSave(invitationPayload(values)))}
        className="flex flex-col gap-3 rounded-card border border-border bg-secondary/30 p-4 text-start"
        aria-label={t(locale, 'invitations.title')}
      >
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          <InvitationFields choices={choices} companyId={companyId} />
        </fieldset>
        <button
          type="submit"
          disabled={!confirmed || !scopeReady || pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {t(locale, 'invitations.submit')}
        </button>
      </form>
    </FormProvider>
  );
}
