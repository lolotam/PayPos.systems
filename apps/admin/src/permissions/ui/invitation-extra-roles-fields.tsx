'use client';

import type { InviteMemberInput, InvitableRole, InvitationRoleAssignment } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';
import {
  INVITABLE_ROLE_OPTIONS,
  scopeName,
  scopeOptionsForRole,
  type InvitationScopeChoices,
} from '../model/invitable-roles';
import { InvitationSelectField } from './invitation-input-fields';

/** سطر دور مع نطاقه في قائمة «أدوار أكتر». */
function ExtraRoleRow({
  entry,
  choices,
  onRemove,
}: {
  entry: InvitationRoleAssignment;
  choices: InvitationScopeChoices;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const label =
    INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === entry.role)?.labelKey ??
    'invitations.roleAccountant';
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-sm">
        {t(locale, label)}
        {' · '}
        {scopeName(entry.scope, choices) ?? t(locale, 'invitations.extraScopeCompany')}
      </span>
      <button type="button" className="rounded-md border px-2 py-1 text-sm" onClick={onRemove}>
        {t(locale, 'invitations.removeRole')}
      </button>
    </li>
  );
}

/** اختيار الدور الإضافي الجديد. */
function ExtraRoleSelect({
  role,
  onChange,
}: {
  role: InvitableRole;
  onChange: (role: InvitableRole) => void;
}) {
  const locale = useLocale();
  return (
    <InvitationSelectField
      id="invitation-extra-role"
      label="invitations.extraRoleLabel"
      value={role}
      choices={INVITABLE_ROLE_OPTIONS.map((candidate) => ({
        value: candidate.role,
        label: t(locale, candidate.labelKey),
      }))}
      onChange={(value) => onChange(value as InvitableRole)}
    />
  );
}

/** اختيار نطاق الدور الإضافي: الشركة تلقائياً، والأنشطة والفروع بقائمة. */
function ExtraScopeSelect({
  role,
  choices,
  scopeId,
  onChange,
}: {
  role: InvitableRole;
  choices: InvitationScopeChoices;
  scopeId: string;
  onChange: (scopeId: string) => void;
}) {
  const locale = useLocale();
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  if (option?.scopeType === 'COMPANY') {
    return (
      <p className="text-sm text-muted-foreground">{t(locale, 'invitations.extraScopeCompany')}</p>
    );
  }
  return (
    <InvitationSelectField
      id="invitation-extra-scope"
      label="invitations.extraScopeLabel"
      value={scopeId}
      placeholder="permissions.choose"
      choices={scopeOptionsForRole(role, choices).map((candidate) => ({
        value: candidate.id,
        label: candidate.name,
      }))}
      onChange={onChange}
    />
  );
}

/** اختيار الدور الإضافي الجديد ونطاقه. */
function ExtraRolePicker({
  choices,
  companyId,
  onAdd,
}: {
  choices: InvitationScopeChoices;
  companyId: string;
  onAdd: (
    role: InvitableRole,
    scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
    scopeId: string,
  ) => void;
}) {
  const locale = useLocale();
  const [role, setRole] = useState<InvitableRole>('business_manager');
  const [scopeId, setScopeId] = useState('');
  const option = INVITABLE_ROLE_OPTIONS.find((candidate) => candidate.role === role);
  const scopeType = option?.scopeType ?? 'COMPANY';
  const effectiveScopeId = scopeType === 'COMPANY' ? companyId : scopeId;
  return (
    <>
      <ExtraRoleSelect
        role={role}
        onChange={(value) => {
          setRole(value);
          setScopeId('');
        }}
      />
      <ExtraScopeSelect role={role} choices={choices} scopeId={scopeId} onChange={setScopeId} />
      <button
        type="button"
        className="self-start rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        disabled={scopeType !== 'COMPANY' && effectiveScopeId === ''}
        onClick={() => onAdd(role, scopeType, effectiveScopeId)}
      >
        {t(locale, 'invitations.addRole')}
      </button>
    </>
  );
}

/**
 * «أدوار أكتر»: كل سطر دور مع نطاقه، وبيتحول لعضوية مستقلة في نفس الدعوة.
 */
export function InvitationExtraRolesFields({
  choices,
  companyId,
}: {
  choices: InvitationScopeChoices;
  companyId: string;
}) {
  const locale = useLocale();
  const form = useFormContext<InviteMemberInput>();
  const additional = useWatch({ control: form.control, name: 'additional_roles' }) ?? [];
  const add = (
    role: InvitableRole,
    scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
    scopeId: string,
  ) => {
    form.setValue('additional_roles', [
      ...additional,
      { role, scope: { type: scopeType, id: scopeId } },
    ]);
  };
  const remove = (index: number) => {
    form.setValue(
      'additional_roles',
      additional.filter((_, position) => position !== index),
    );
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border p-3">
      <legend className="text-sm font-medium">{t(locale, 'invitations.additionalRolesTitle')}</legend>
      {additional.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'invitations.additionalRolesEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {additional.map((entry, index) => (
            <ExtraRoleRow
              key={`${entry.role}:${entry.scope.type}:${entry.scope.id}-${index}`}
              entry={entry}
              choices={choices}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}
      <ExtraRolePicker choices={choices} companyId={companyId} onAdd={add} />
    </fieldset>
  );
}
