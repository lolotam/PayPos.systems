'use client';

import type { PermissionOverrideInput } from '@pospay/contracts';
import { PERMISSION_CATALOG_CODES, permissionModuleName, permissionName, t } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { extraBranchName, type StaffExtraBranchOption } from './employee-access-extra-branches';

export type OverrideScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** سطر استثناء في القائمة: صلاحيته وأثره ونطاقه وزر شيله. */
export function OverrideRow({
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
      ? branch === undefined
        ? t(locale, 'permissions.branch')
        : extraBranchName(branch, locale)
      : t(
          locale,
          terms.scope_type === 'COMPANY'
            ? 'invitations.overrideScopeCompany'
            : 'permissions.business',
        );
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

/**
 * يقسّم كتالوج الصلاحيات حسب الوحدة (القطعة الوسطى من الكود) عشان القايمة تتقرأ بالمجموعات
 * بدل قائمة طويلة مسطحة.
 */
function permissionGroups(): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const code of [...PERMISSION_CATALOG_CODES].sort()) {
    const moduleKey = code.split(':')[1] ?? code;
    const codes = groups.get(moduleKey) ?? [];
    codes.push(code);
    groups.set(moduleKey, codes);
  }
  return groups;
}

/** الصلاحية والأثر: أول حاجتين بتتحدد في الاستثناء. */
function OverrideDecisionFields({
  code,
  effect,
  defaults,
  onCode,
  onEffect,
}: {
  code: string;
  effect: 'ALLOW' | 'DENY';
  defaults: ReadonlySet<string>;
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
        {[...permissionGroups()].map(([moduleKey, codes]) => (
          <optgroup key={moduleKey} label={permissionModuleName(locale, moduleKey)}>
            {codes.map((candidate) => (
              <option key={candidate} value={candidate}>
                {permissionName(locale, candidate)} · {candidate}
                {defaults.has(candidate) ? ` · (${t(locale, 'staff.overrideDefaultBadge')})` : ''}
              </option>
            ))}
          </optgroup>
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

/** مدخلات منتقي الاستثناء: الشركة والنطاق والفروع والصلاحيات الافتراضية والسقف. */
export interface OverridePickerInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly branches: readonly StaffExtraBranchOption[];
  /**
   * الصلاحيات الافتراضية للنطاق المختار — بتطلع بعلامة «افتراضي». الخدمة بتتبع النطاق
   * عشان استثناء على فرع إضافي يقارن بدور ذلك الفرع مش بدور الفرع الأساسي.
   */
  readonly defaultsForScope: (scopeType: OverrideScopeType, scopeId: string) => ReadonlySet<string>;
  /** هل وصلنا سقف الاستثناءات — التوليد مقفول فوقه. */
  readonly atLimit: boolean;
  readonly onAdd: (terms: PermissionOverrideInput) => void;
}

/** شروط الاستثناء الجاهزة للإضافة، أو null لو الكود أو السبب أو النطاق ناقص أو الوقت مش صالح. */
function readyOverrideTerms(input: {
  readonly code: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: OverrideScopeType;
  readonly scopeId: string;
  readonly reason: string;
  readonly expiresAt: string;
}): PermissionOverrideInput | null {
  if (input.code === '' || input.reason.trim() === '' || input.scopeId === '') return null;
  if (input.expiresAt !== '' && Number.isNaN(Date.parse(input.expiresAt))) return null;
  return {
    permission_code: input.code,
    effect: input.effect,
    scope_type: input.scopeType,
    scope_id: input.scopeId,
    reason: input.reason.trim(),
    expires_at: input.expiresAt === '' ? null : new Date(input.expiresAt).toISOString(),
  };
}

/** زر الإضافة وسقف الاستثناءات — يظهر الحد مع القايمة. */
function OverrideAddButton({
  ready,
  atLimit,
  onAdd,
}: {
  ready: boolean;
  atLimit: boolean;
  onAdd: () => void;
}) {
  const locale = useLocale();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={!ready || atLimit}
        onClick={onAdd}
      >
        {t(locale, 'invitations.addOverride')}
      </Button>
      {atLimit ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'staff.inlineOverridesLimit')}</p>
      ) : null}
    </>
  );
}

/** اختيار الاستثناء الجديد: الصلاحية والأثر والنطاق والسبب. */
export function OverridePicker({
  companyId,
  businessId,
  branches,
  defaultsForScope,
  atLimit,
  onAdd,
}: OverridePickerInput) {
  const [code, setCode] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [scopeType, setScopeType] = useState<OverrideScopeType>('COMPANY');
  const [scopeId, setScopeId] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const effectiveScopeId =
    scopeType === 'COMPANY' ? companyId : scopeType === 'BUSINESS' ? businessId : scopeId;
  const defaults = defaultsForScope(scopeType, effectiveScopeId);
  const terms = readyOverrideTerms({
    code,
    effect,
    scopeType,
    scopeId: effectiveScopeId,
    reason,
    expiresAt,
  });
  const add = () => {
    if (terms === null || atLimit) return;
    onAdd(terms);
    setReason('');
    setExpiresAt('');
  };
  return (
    <>
      <OverrideDecisionFields
        code={code}
        effect={effect}
        defaults={defaults}
        onCode={setCode}
        onEffect={setEffect}
      />
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
      <OverrideAddButton ready={terms !== null} atLimit={atLimit} onAdd={add} />
    </>
  );
}
