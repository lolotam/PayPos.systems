'use client';

import type { PermissionOverrideInput } from '@pospay/contracts';
import { PERMISSION_CATALOG_CODES, permissionName, t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';
import type { InvitationScopeChoices } from '../model/invitable-roles';
import { InvitationSelectField, InvitationTextField } from './invitation-input-fields';

export type OverrideScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** الصلاحية والأثر: أول حاجتين بتتحدد في الاستثناء. */
export function OverrideDecisionFields({
  code,
  effect,
  onCode,
  onEffect,
}: {
  code: string;
  effect: 'ALLOW' | 'DENY';
  onCode: (code: string) => void;
  onEffect: (effect: 'ALLOW' | 'DENY') => void;
}) {
  const locale = useLocale();
  return (
    <>
      <InvitationSelectField
        id="invitation-override-permission"
        label="invitations.overridePermissionLabel"
        value={code}
        placeholder="permissions.choosePermission"
        choices={[...PERMISSION_CATALOG_CODES]
          .sort()
          .map((candidate) => ({
            value: candidate,
            label: `${permissionName(locale, candidate)} · ${candidate}`,
          }))}
        onChange={onCode}
      />
      <InvitationSelectField
        id="invitation-override-effect"
        label="invitations.overrideEffectLabel"
        value={effect}
        choices={[
          { value: 'ALLOW', label: t(locale, 'invitations.overrideAllowLabel') },
          { value: 'DENY', label: t(locale, 'invitations.overrideDenyLabel') },
        ]}
        onChange={(value) => onEffect(value === 'DENY' ? 'DENY' : 'ALLOW')}
      />
    </>
  );
}

/** نطاق الاستثناء: نوعه ومعرفه، والشركة من غير اختيار. */
export function OverrideScopeFields({
  choices,
  scopeType,
  scopeId,
  onScopeType,
  onScopeId,
}: {
  choices: InvitationScopeChoices;
  scopeType: OverrideScopeType;
  scopeId: string;
  onScopeType: (scopeType: OverrideScopeType) => void;
  onScopeId: (scopeId: string) => void;
}) {
  const locale = useLocale();
  const options =
    scopeType === 'BUSINESS' ? choices.businesses : scopeType === 'BRANCH' ? choices.branches : [];
  return (
    <>
      <InvitationSelectField
        id="invitation-override-scope-type"
        label="invitations.overrideScopeTypeLabel"
        value={scopeType}
        choices={[
          { value: 'COMPANY', label: t(locale, 'permissions.company') },
          { value: 'BUSINESS', label: t(locale, 'permissions.business') },
          { value: 'BRANCH', label: t(locale, 'permissions.branch') },
        ]}
        onChange={(value) => onScopeType(value as OverrideScopeType)}
      />
      {scopeType === 'COMPANY' ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'invitations.overrideScopeCompany')}</p>
      ) : (
        <InvitationSelectField
          id="invitation-override-scope-id"
          label="invitations.overrideScopeIdLabel"
          value={scopeId}
          placeholder="permissions.choose"
          choices={options.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          onChange={onScopeId}
        />
      )}
    </>
  );
}

/** السبب ووقت الانتهاء. */
export function OverrideReasonFields({
  reason,
  expiresAt,
  onReason,
  onExpiresAt,
}: {
  reason: string;
  expiresAt: string;
  onReason: (reason: string) => void;
  onExpiresAt: (expiresAt: string) => void;
}) {
  return (
    <>
      <InvitationTextField
        id="invitation-override-reason"
        label="invitations.overrideReasonLabel"
        value={reason}
        maxLength={500}
        onChange={onReason}
      />
      <InvitationTextField
        id="invitation-override-expiry"
        label="invitations.overrideExpiresAtLabel"
        value={expiresAt}
        inputType="datetime-local"
        onChange={onExpiresAt}
      />
    </>
  );
}

/** صياغة الاستثناء الجديد من اختيارات اللوحة؛ وقت الانتهاء اختياري. */
export function overrideTerms(
  code: string,
  effect: 'ALLOW' | 'DENY',
  scopeType: OverrideScopeType,
  scopeId: string,
  reason: string,
  expiresAt: string,
): PermissionOverrideInput {
  return {
    permission_code: code,
    effect,
    scope_type: scopeType,
    scope_id: scopeId,
    reason: reason.trim(),
    expires_at: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
  };
}
