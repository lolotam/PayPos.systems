'use client';

import { Popover } from 'radix-ui';

import { WorkspaceSwitcherField } from './workspace-switcher-field.js';
import type { SelectOption } from './select.js';

export type WorkspaceSwitcherLabels = {
  /** الاسم المتاح لقائمة مبدّل مساحة العمل نفسها — من المستدعي المترجم. */
  switcher: string;
  company: string;
  business: string;
  branch: string;
};

/** قيم وخيارات وتعطيل كل حقل من حقول مبدّل مساحة العمل الثلاثة. */
export type WorkspaceSwitcherFieldState = {
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean | undefined;
  onValueChange: (value: string) => void;
};

/**
 * جسم قائمة مبدّل مساحة العمل: شركة ثم نشاط ثم فرع، بالترتيب نفسه الذي
 * يعرضه الزر، وكل حقل بقرار المستدعي الكامل.
 */
export function WorkspaceSwitcherContent({
  id,
  labels,
  company,
  business,
  branch,
}: {
  id: string;
  labels: WorkspaceSwitcherLabels;
  company: WorkspaceSwitcherFieldState;
  business: WorkspaceSwitcherFieldState;
  branch: WorkspaceSwitcherFieldState;
}) {
  return (
    // الاسم المتاح من المستدعي يسمّي الحوار: قارئ الشاشة يدخل اللوحة النمطية
    // ويسمع اسمها قبل الحقول الثلاثة.
    <Popover.Content
      align="start"
      sideOffset={8}
      aria-label={labels.switcher}
      className="z-50 flex w-72 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm focus-visible:outline-none"
    >
      <WorkspaceSwitcherField
        id={`${id}-company`}
        label={labels.company}
        value={company.value}
        options={company.options}
        disabled={company.disabled}
        onValueChange={company.onValueChange}
      />
      <WorkspaceSwitcherField
        id={`${id}-business`}
        label={labels.business}
        value={business.value}
        options={business.options}
        disabled={business.disabled}
        onValueChange={business.onValueChange}
      />
      <WorkspaceSwitcherField
        id={`${id}-branch`}
        label={labels.branch}
        value={branch.value}
        options={branch.options}
        disabled={branch.disabled}
        onValueChange={branch.onValueChange}
      />
    </Popover.Content>
  );
}
