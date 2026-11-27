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
import { OverridePicker, OverrideRow } from './employee-access-override-fields';

/** أقصى عدد استثناءات صلاحيات في الطلب الواحد (080-b) — نفس حد العقد في السيرفر. */
export const MAX_INLINE_OVERRIDES = 20;

/** صلاحيات كل دور افتراضية بنفس ترتيب العقد في packages/contracts. */
const ROLE_DEFAULTS: Record<'staff' | 'reception', readonly string[]> = STAFF_ACCESS_ROLE_DEFAULTS;

/**
 * «استثناء صلاحية»: استثناءات بتتكتب مع عضويات الموظفة في نفس المنح — السيرفر بيفحصها
 * بنفس قواعد شاشة الصلاحيات فما فيش صلاحية بتتسلل من الشاشة.
 *
 * الصلاحيات اللي الموظفة عندها افتراضياً بدورها بيطلعوا بعلامة «افتراضي» عشان المدير
 * يشوف إن الاستثناء ده بيكرر صلاحية موجودة أصلاً.
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
  const primaryRole = form.watch('role');
  const extraRoles = (form.watch('additional_branches') ?? []).map((entry) => entry.role);
  const defaults = new Set<string>(
    [primaryRole, ...extraRoles].flatMap((role) => [...ROLE_DEFAULTS[role]]),
  );
  const atLimit = overrides.length >= MAX_INLINE_OVERRIDES;
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
        defaults={defaults}
        atLimit={atLimit}
        onAdd={add}
      />
      {form.formState.errors.permission_overrides ? (
        <p role="alert">{t(locale, 'staff.inlineOverridesLimit')}</p>
      ) : null}
    </details>
  );
}
