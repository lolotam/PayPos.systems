'use client';

import type { InviteMemberInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useFormContext, useWatch } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';
import {
  INVITABLE_ROLE_OPTIONS,
  isSameAssignment,
  scopeOptionsForRole,
  type InvitationScopeChoices,
} from '../model/invitable-roles';

/**
 * اختيار أكتر من فرع أو أكتر من نشاط («أكتر من فرع» و«أكتر من نشاط»): القوائم بتظهر للأدوار
 * اللي نطاقها فرع أو نشاط، وكل اختيار زيادة بيتضاف دور مع نطاقه في additional_roles — والنطاق
 * الأساسي ما بيتكررش، لأن اختيار النطاق الأساسي بيبدّل السطر بتاعه.
 */
export function InvitationMultiScopeFields({ choices }: { choices: InvitationScopeChoices }) {
  const locale = useLocale();
  const form = useFormContext<InviteMemberInput>();
  const role = useWatch({ control: form.control, name: 'role' });
  const primaryScopeId = useWatch({ control: form.control, name: 'scope.id' });
  const additional = useWatch({ control: form.control, name: 'additional_roles' }) ?? [];
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  const scopeType = option?.scopeType;
  const options = scopeOptionsForRole(role, choices);
  if (scopeType !== 'BRANCH' && scopeType !== 'BUSINESS') return null;
  if (options.length < 2) return null;
  const label =
    scopeType === 'BRANCH' ? 'invitations.extraBranchesLabel' : 'invitations.extraBusinessesLabel';
  const toggle = (id: string, checked: boolean) => {
    const kept = additional.filter((entry) => !isSameAssignment(entry, role, scopeType, id));
    form.setValue(
      'additional_roles',
      checked ? [...kept, { role, scope: { type: scopeType, id } }] : kept,
    );
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border p-3">
      <legend className="text-sm font-medium">{t(locale, label)}</legend>
      <p className="text-sm text-muted-foreground">{t(locale, 'invitations.extraScopesLead')}</p>
      {options
        .filter((candidate) => candidate.id !== primaryScopeId)
        .map((candidate) => (
          <label key={candidate.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={additional.some((entry) =>
                isSameAssignment(entry, role, scopeType, candidate.id),
              )}
              onChange={(event) => toggle(candidate.id, event.target.checked)}
            />
            <span className="text-sm">{candidate.name}</span>
          </label>
        ))}
    </fieldset>
  );
}
