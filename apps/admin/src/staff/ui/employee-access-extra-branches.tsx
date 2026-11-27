'use client';

import type { GrantStaffAccessInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

/** أقصى عدد فروع زيادة في الطلب الواحد (080-b) — نفس حد العقد في السيرفر. */
export const MAX_EXTRA_BRANCHES = 20;

/** فرع من فروع النشاط المعروض في قائمة الزيادة. */
export interface StaffExtraBranchOption {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  /** الفرع مؤرشف (مش نشط) — ما بياخدش فرع زيادة. */
  readonly is_active?: boolean | undefined;
}

/** اسم الفرع بلغة الواجهة: العربية لو متاحة وإلا الإنجليزي. */
export function extraBranchName(option: StaffExtraBranchOption, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? (option.name_ar ?? option.name_en) : option.name_en;
}

/** سطر فرع زيادة في القائمة: اسمه ودوره وزر شيله. */
function ExtraBranchRow({
  entry,
  options,
  onRemove,
}: {
  entry: { branch_id: string; role: 'staff' | 'reception' };
  options: readonly StaffExtraBranchOption[];
  onRemove: () => void;
}) {
  const locale = useLocale();
  const option = options.find((candidate) => candidate.id === entry.branch_id);
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-sm">
        {option === undefined ? entry.branch_id : extraBranchName(option, locale)}
        {' · '}
        {entry.role === 'staff' ? t(locale, 'staff.roleStaff') : t(locale, 'staff.roleReception')}
      </span>
      <Button type="button" variant="outline" onClick={onRemove}>
        {t(locale, 'staff.removeExtraBranch')}
      </Button>
    </li>
  );
}

/** اختيار الفرع الإضافي ودوره وإضافته للقائمة. */
function ExtraBranchPicker({
  options,
  atLimit,
  onAdd,
}: {
  options: readonly StaffExtraBranchOption[];
  atLimit: boolean;
  onAdd: (branchId: string, role: 'staff' | 'reception') => void;
}) {
  const locale = useLocale();
  const [branchId, setBranchId] = useState('');
  const [role, setRole] = useState<'staff' | 'reception'>('staff');
  const add = () => {
    if (branchId === '') return;
    onAdd(branchId, role);
    setBranchId('');
  };
  return (
    <>
      <Label htmlFor="staff-access-extra-branch">{t(locale, 'staff.extraBranchLabel')}</Label>
      <select
        id="staff-access-extra-branch"
        value={branchId}
        onChange={(event) => setBranchId(event.target.value)}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {extraBranchName(option, locale)}
          </option>
        ))}
      </select>
      <Label htmlFor="staff-access-extra-branch-role">
        {t(locale, 'staff.extraBranchRoleLabel')}
      </Label>
      <select
        id="staff-access-extra-branch-role"
        value={role}
        onChange={(event) => setRole(event.target.value === 'reception' ? 'reception' : 'staff')}
      >
        <option value="staff">{t(locale, 'staff.roleStaff')}</option>
        <option value="reception">{t(locale, 'staff.roleReception')}</option>
      </select>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={branchId === '' || atLimit}
        onClick={add}
      >
        {t(locale, 'staff.addExtraBranch')}
      </Button>
      {atLimit ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'staff.extraBranchesLimit')}</p>
      ) : null}
    </>
  );
}

/**
 * «فروع زيادة»: كل فرع بيتحول لعضوية مستقلة بنفس الدخول، ودوره بيتختار معاه.
 * الفرع الأساسي ما بيتردشش في القائمة — هو أساس منح الدخول مش فرع زيادة — والفرع المؤرشف
 * والفرع المضاف قبل كده ما بيتردوش، عشان الطلب ما يبقاش فيه فرع مكرر أو فرع مش شغال.
 */
export function EmployeeAccessExtraBranches({
  form,
  branches,
  primaryBranchId,
}: {
  form: UseFormReturn<GrantStaffAccessInput>;
  branches: readonly StaffExtraBranchOption[];
  primaryBranchId?: string | undefined;
}) {
  const locale = useLocale();
  const selected = form.watch('additional_branches') ?? [];
  const activeBranches = branches.filter((branch) => branch.is_active !== false);
  const options = activeBranches.filter(
    (branch) =>
      branch.id !== primaryBranchId &&
      !selected.some((entry) => entry.branch_id === branch.id),
  );
  const atLimit = selected.length >= MAX_EXTRA_BRANCHES;
  const add = (branchId: string, role: 'staff' | 'reception') => {
    if (atLimit) return;
    form.setValue('additional_branches', [...selected, { branch_id: branchId, role }]);
  };
  const remove = (index: number) => {
    form.setValue(
      'additional_branches',
      selected.filter((_, position) => position !== index),
    );
  };
  return (
    <details className="flex flex-col gap-2 rounded-md border p-3">
      <summary className="text-sm font-medium">{t(locale, 'staff.extraBranchesTitle')}</summary>
      {selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'staff.extraBranchesEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {selected.map((entry, index) => (
            <ExtraBranchRow
              key={`${entry.branch_id}:${entry.role}:${index}`}
              entry={entry}
              options={activeBranches}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}
      {primaryBranchId !== undefined ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'staff.extraBranchesSamePrimaryHint')}
        </p>
      ) : null}
      <ExtraBranchPicker options={options} atLimit={atLimit} onAdd={add} />
      {form.formState.errors.additional_branches ? (
        <p role="alert">{t(locale, 'staff.extraBranchesLimit')}</p>
      ) : null}
    </details>
  );
}
