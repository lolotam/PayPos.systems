'use client';

import type { InviteMemberInput, PermissionOverrideInput } from '@pospay/contracts';
import { permissionName, t } from '@pospay/i18n';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';
import { scopeName, type InvitationScopeChoices } from '../model/invitable-roles';
import {
  OverrideDecisionFields,
  OverrideReasonFields,
  OverrideScopeFields,
  overrideTerms,
  type OverrideScopeType,
} from './invitation-override-fields';

/** سطر استثناء صلاحية في لوحة «استثناء صلاحية». */
function OverrideRow({
  terms,
  choices,
  onRemove,
}: {
  terms: PermissionOverrideInput;
  choices: InvitationScopeChoices;
  onRemove: () => void;
}) {
  const locale = useLocale();
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-sm">
        {permissionName(locale, terms.permission_code)}
        {' · '}
        {terms.effect === 'ALLOW'
          ? t(locale, 'invitations.overrideAllowLabel')
          : t(locale, 'invitations.overrideDenyLabel')}
        {' · '}
        {scopeName({ type: terms.scope_type, id: terms.scope_id }, choices) ??
          t(locale, 'invitations.overrideScopeCompany')}
      </span>
      <button type="button" className="rounded-md border px-2 py-1 text-sm" onClick={onRemove}>
        {t(locale, 'invitations.removeOverride')}
      </button>
    </li>
  );
}

/** بناء الاستثناء الجديد: الصلاحية والأثر والنطاق والسبب. */
function OverridePicker({
  choices,
  companyId,
  onAdd,
}: {
  choices: InvitationScopeChoices;
  companyId: string;
  onAdd: (terms: PermissionOverrideInput) => void;
}) {
  const locale = useLocale();
  const [code, setCode] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [scopeType, setScopeType] = useState<OverrideScopeType>('COMPANY');
  const [scopeId, setScopeId] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const effectiveScopeId = scopeType === 'COMPANY' ? companyId : scopeId;
  const ready = code !== '' && reason.trim() !== '' && effectiveScopeId !== '';
  const add = () => {
    if (!ready) return;
    onAdd(overrideTerms(code, effect, scopeType, effectiveScopeId, reason, expiresAt));
    setReason('');
    setExpiresAt('');
  };
  return (
    <>
      <OverrideDecisionFields code={code} effect={effect} onCode={setCode} onEffect={setEffect} />
      <OverrideScopeFields
        choices={choices}
        scopeType={scopeType}
        scopeId={scopeId}
        onScopeType={(value) => {
          setScopeType(value);
          setScopeId('');
        }}
        onScopeId={setScopeId}
      />
      <OverrideReasonFields
        reason={reason}
        expiresAt={expiresAt}
        onReason={setReason}
        onExpiresAt={setExpiresAt}
      />
      <button
        type="button"
        className="self-start rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        disabled={!ready}
        onClick={add}
      >
        {t(locale, 'invitations.addOverride')}
      </button>
    </>
  );
}

/**
 * «استثناء صلاحية»: لوحة قابلة للطيّ فيها استثناءات الصلاحية اللي بتتكتب مع العضويات في نفس
 * الدعوة — بتتحقق منها السيرفر بنفس قواعد شاشة الصلاحيات.
 */
export function InvitationInlineOverrides({
  choices,
  companyId,
}: {
  choices: InvitationScopeChoices;
  companyId: string;
}) {
  const locale = useLocale();
  const form = useFormContext<InviteMemberInput>();
  const overrides = useWatch({ control: form.control, name: 'permission_overrides' }) ?? [];
  const add = (terms: PermissionOverrideInput) => {
    form.setValue('permission_overrides', [...overrides, terms]);
  };
  const remove = (index: number) => {
    form.setValue(
      'permission_overrides',
      overrides.filter((_, position) => position !== index),
    );
  };
  return (
    <details className="rounded-md border p-3">
      <summary className="text-sm font-medium">{t(locale, 'invitations.inlineOverridesTitle')}</summary>
      <div className="mt-2 flex flex-col gap-2">
        {overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(locale, 'invitations.inlineOverridesEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {overrides.map((terms, index) => (
              <OverrideRow
                key={`${terms.permission_code}:${terms.scope_type}:${terms.scope_id}:${index}`}
                terms={terms}
                choices={choices}
                onRemove={() => remove(index)}
              />
            ))}
          </ul>
        )}
        <OverridePicker choices={choices} companyId={companyId} onAdd={add} />
      </div>
    </details>
  );
}
