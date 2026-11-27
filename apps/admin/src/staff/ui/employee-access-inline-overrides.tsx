'use client';

import {
  STAFF_ACCESS_ROLE_DEFAULTS,
  type GrantStaffAccessInput,
  type PermissionOverrideInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { StaffExtraBranchOption } from './employee-access-extra-branches';
import {
  OverridePicker,
  OverrideRow,
  type OverrideScopeType,
} from './employee-access-override-fields';

/** أقصى عدد استثناءات صلاحيات في الطلب الواحد (080-b) — نفس حد العقد في السيرفر. */
export const MAX_INLINE_OVERRIDES = 20;

/** صلاحيات كل دور افتراضية بنفس ترتيب العقد في packages/contracts. */
const ROLE_DEFAULTS: Record<'staff' | 'reception', readonly string[]> = STAFF_ACCESS_ROLE_DEFAULTS;

/**
 * الصلاحيات الافتراضية للنطاق المختار: فرع زيادة بيقارن بدور ذلك الفرع، والفرع الأساسي
 * بيقارن بدوره، ونطاق الشركة أو النشاط بيقارن بدور الفرع الأساسي.
 */
function scopeDefaults(
  scopeType: OverrideScopeType,
  targetId: string,
  input: {
    primaryRole: 'staff' | 'reception';
    primaryBranchId?: string | undefined;
    extraBranches: readonly { branch_id: string; role: 'staff' | 'reception' }[];
  },
): ReadonlySet<string> {
  if (scopeType === 'BRANCH' && targetId !== '') {
    const extra = input.extraBranches.find(
      (entry) => entry.branch_id.toLowerCase() === targetId.toLowerCase(),
    );
    if (extra !== undefined) return new Set(ROLE_DEFAULTS[extra.role]);
    if (
      input.primaryBranchId !== undefined &&
      input.primaryBranchId.toLowerCase() === targetId.toLowerCase()
    )
      return new Set(ROLE_DEFAULTS[input.primaryRole]);
    return new Set<string>();
  }
  return new Set(ROLE_DEFAULTS[input.primaryRole]);
}

/** قائمة الاستثناءات المضافة: كل سطر بصلاحيته وأثره ونطاقه وزر شيله. */
function InlineOverrideList({
  overrides,
  branches,
  onRemove,
}: {
  overrides: readonly PermissionOverrideInput[];
  branches: readonly StaffExtraBranchOption[];
  onRemove: (index: number) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {overrides.map((terms, index) => (
        <OverrideRow
          key={`${terms.permission_code}:${terms.scope_type}:${terms.scope_id}:${index}`}
          terms={terms}
          branches={branches}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ul>
  );
}

/**
 * «استثناء صلاحية»: استثناءات بتتكتب مع عضويات الموظفة في نفس المنح — السيرفر بيفحصها
 * بنفس قواعد شاشة الصلاحيات فما فيش صلاحية بتتسلل من الشاشة.
 *
 * الصلاحيات اللي الموظفة عندها افتراضياً بدورها بيطلعوا بعلامة «افتراضي» عشان المدير
 * يشوف إن الاستثناء ده بيكرر صلاحية موجودة أصلاً. العلامة بتتبع النطاق المختار: استثناء
 * على فرع إضافي بيقارن بدور ذلك الفرع، ونطاق الشركة أو النشاط بيقارن بدور الفرع الأساسي.
 */
export function EmployeeAccessInlineOverrides({
  form,
  companyId,
  businessId,
  branches,
  primaryBranchId,
}: {
  form: UseFormReturn<GrantStaffAccessInput>;
  companyId: string;
  businessId: string;
  branches: readonly StaffExtraBranchOption[];
  primaryBranchId?: string | undefined;
}) {
  const locale = useLocale();
  const overrides = form.watch('permission_overrides') ?? [];
  const primaryRole = form.watch('role');
  const extraBranches = form.watch('additional_branches') ?? [];
  const atLimit = overrides.length >= MAX_INLINE_OVERRIDES;
  const defaultsForScope = (scopeType: OverrideScopeType, targetId: string): ReadonlySet<string> =>
    scopeDefaults(scopeType, targetId, { primaryRole, primaryBranchId, extraBranches });
  const add = (terms: PermissionOverrideInput) => {
    if (atLimit) return;
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
      <summary className="text-sm font-medium">
        {t(locale, 'invitations.inlineOverridesTitle')}
      </summary>
      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'invitations.inlineOverridesEmpty')}
        </p>
      ) : (
        <InlineOverrideList overrides={overrides} branches={branches} onRemove={remove} />
      )}
      <OverridePicker
        companyId={companyId}
        businessId={businessId}
        branches={branches}
        defaultsForScope={defaultsForScope}
        atLimit={atLimit}
        onAdd={add}
      />
      {form.formState.errors.permission_overrides ? (
        <p role="alert">{t(locale, 'staff.inlineOverridesLimit')}</p>
      ) : null}
    </details>
  );
}
