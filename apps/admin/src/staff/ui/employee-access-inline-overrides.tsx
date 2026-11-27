'use client';

import type { GrantStaffAccessInput, PermissionOverrideInput } from '@pospay/contracts';
import { PERMISSION_CATALOG_CODES, permissionName, t } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { extraBranchName, type StaffExtraBranchOption } from './employee-access-extra-branches';

type OverrideScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** سطر استثناء في القائمة: صلاحيته وأثره ونطاقه وزر شيله. */
function OverrideRow({
  terms,
  branches,
  onRemove,
}: {
  terms: PermissionOverrideInput;
  branches: readonly StaffExtraBranchOption[];
  onRemove: () => void;
}) {
  const locale = useLocale();
  const branch = branches.find((candidate) => candidate.id === terms.scope_id);
  const scope =
    terms.scope_type === 'BRANCH'
      ? (branch === undefined ? t(locale, 'permissions.branch') : extraBranchName(branch, locale))
      : t(locale, terms.scope_type === 'COMPANY' ? 'invitations.overrideScopeCompany' : 'permissions.business');
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-sm">
        {permissionName(locale, terms.permission_code)}
        {' · '}
        {terms.effect === 'ALLOW'
          ? t(locale, 'invitations.overrideAllowLabel')
          : t(locale, 'invitations.overrideDenyLabel')}
        {' · '}
        {scope}
      </span>
      <Button type="button" variant="outline" onClick={onRemove}>
        {t(locale, 'invitations.removeOverride')}
      </Button>
    </li>
  );
}

/** الصلاحية والأثر: أول حاجتين بتتحدد في الاستثناء. */
function OverrideDecisionFields({
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
      <Label htmlFor="staff-access-override-permission">
        {t(locale, 'invitations.overridePermissionLabel')}
      </Label>
      <select
        id="staff-access-override-permission"
        value={code}
        onChange={(event) => onCode(event.target.value)}
      >
        <option value="">—</option>
        {[...PERMISSION_CATALOG_CODES]
          .sort()
          .map((candidate) => (
            <option key={candidate} value={candidate}>
              {permissionName(locale, candidate)} · {candidate}
            </option>
          ))}
      </select>
      <Label htmlFor="staff-access-override-effect">
        {t(locale, 'invitations.overrideEffectLabel')}
      </Label>
      <select
        id="staff-access-override-effect"
        value={effect}
        onChange={(event) => onEffect(event.target.value === 'DENY' ? 'DENY' : 'ALLOW')}
      >
        <option value="ALLOW">{t(locale, 'invitations.overrideAllowLabel')}</option>
        <option value="DENY">{t(locale, 'invitations.overrideDenyLabel')}</option>
      </select>
    </>
  );
}

/** نوع النطاق ومعرفه: الشركة تلقائياً، والفرع من قائمة فروع النشاط. */
function OverrideScopeFields({
  scopeType,
  scopeId,
  branches,
  onScopeType,
  onScopeId,
}: {
  scopeType: OverrideScopeType;
  scopeId: string;
  branches: readonly StaffExtraBranchOption[];
  onScopeType: (scopeType: OverrideScopeType) => void;
  onScopeId: (scopeId: string) => void;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="staff-access-override-scope-type">
        {t(locale, 'invitations.overrideScopeTypeLabel')}
      </Label>
      <select
        id="staff-access-override-scope-type"
        value={scopeType}
        onChange={(event) => {
          onScopeType(event.target.value as OverrideScopeType);
          onScopeId('');
        }}
      >
        <option value="COMPANY">{t(locale, 'permissions.company')}</option>
        <option value="BUSINESS">{t(locale, 'permissions.business')}</option>
        <option value="BRANCH">{t(locale, 'permissions.branch')}</option>
      </select>
      {scopeType === 'BRANCH' ? (
        <BranchScopeField branches={branches} scopeId={scopeId} onScopeId={onScopeId} />
      ) : null}
    </>
  );
}

/** السبب ووقت الانتهاء. */
function OverrideReasonFields({
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
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="staff-access-override-reason">
        {t(locale, 'invitations.overrideReasonLabel')}
      </Label>
      <input
        id="staff-access-override-reason"
        value={reason}
        maxLength={500}
        onChange={(event) => onReason(event.target.value)}
      />
      <Label htmlFor="staff-access-override-expiry">
        {t(locale, 'invitations.overrideExpiresAtLabel')}
      </Label>
      <input
        id="staff-access-override-expiry"
        type="datetime-local"
        value={expiresAt}
        onChange={(event) => onExpiresAt(event.target.value)}
      />
    </>
  );
}

/** اختيار الاستثناء الجديد: الصلاحية والأثر والنطاق والسبب. */
function OverridePicker({
  companyId,
  businessId,
  branches,
  onAdd,
}: {
  companyId: string;
  businessId: string;
  branches: readonly StaffExtraBranchOption[];
  onAdd: (terms: PermissionOverrideInput) => void;
}) {
  const locale = useLocale();
  const [code, setCode] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [scopeType, setScopeType] = useState<OverrideScopeType>('COMPANY');
  const [scopeId, setScopeId] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const effectiveScopeId =
    scopeType === 'COMPANY' ? companyId : scopeType === 'BUSINESS' ? businessId : scopeId;
  const validExpiry = expiresAt === '' || !Number.isNaN(Date.parse(expiresAt));
  const ready = code !== '' && reason.trim() !== '' && effectiveScopeId !== '' && validExpiry;
  const add = () => {
    if (!ready) return;
    onAdd({
      permission_code: code,
      effect,
      scope_type: scopeType,
      scope_id: effectiveScopeId,
      reason: reason.trim(),
      expires_at: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
    });
    setReason('');
    setExpiresAt('');
  };
  return (
    <>
      <OverrideDecisionFields code={code} effect={effect} onCode={setCode} onEffect={setEffect} />
      <OverrideScopeFields
        scopeType={scopeType}
        scopeId={scopeId}
        branches={branches}
        onScopeType={setScopeType}
        onScopeId={setScopeId}
      />
      <OverrideReasonFields
        reason={reason}
        expiresAt={expiresAt}
        onReason={setReason}
        onExpiresAt={setExpiresAt}
      />
      <Button type="button" variant="outline" className="self-start" disabled={!ready} onClick={add}>
        {t(locale, 'invitations.addOverride')}
      </Button>
    </>
  );
}

/** نطاق الفرع في الاستثناء: قائمة فروع النشاط. */
function BranchScopeField({
  branches,
  scopeId,
  onScopeId,
}: {
  branches: readonly StaffExtraBranchOption[];
  scopeId: string;
  onScopeId: (scopeId: string) => void;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="staff-access-override-scope-id">
        {t(locale, 'invitations.overrideScopeIdLabel')}
      </Label>
      <select
        id="staff-access-override-scope-id"
        value={scopeId}
        onChange={(event) => onScopeId(event.target.value)}
      >
        <option value="">—</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {extraBranchName(branch, locale)}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * «استثناء صلاحية»: استثناءات بتتكتب مع عضويات الموظفة في نفس المنح — السيرفر بيفحصها
 * بنفس قواعد شاشة الصلاحيات فما فيش صلاحية بتتسلل من الشاشة.
 */
export function EmployeeAccessInlineOverrides({
  form,
  companyId,
  businessId,
  branches,
}: {
  form: UseFormReturn<GrantStaffAccessInput>;
  companyId: string;
  businessId: string;
  branches: readonly StaffExtraBranchOption[];
}) {
  const locale = useLocale();
  const overrides = form.watch('permission_overrides') ?? [];
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
    <details className="flex flex-col gap-2 rounded-md border p-3">
      <summary className="text-sm font-medium">{t(locale, 'invitations.inlineOverridesTitle')}</summary>
      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'invitations.inlineOverridesEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {overrides.map((terms, index) => (
            <OverrideRow
              key={`${terms.permission_code}:${terms.scope_type}:${terms.scope_id}:${index}`}
              terms={terms}
              branches={branches}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}
      <OverridePicker
        companyId={companyId}
        businessId={businessId}
        branches={branches}
        onAdd={add}
      />
    </details>
  );
}
