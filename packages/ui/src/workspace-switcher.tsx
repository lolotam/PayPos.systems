'use client';

import { Popover } from 'radix-ui';
import { useId, useState } from 'react';

import {
  WorkspaceSwitcherContent,
  type WorkspaceSwitcherLabels,
} from './workspace-switcher-content.js';
import { WorkspaceSwitcherTrigger } from './workspace-switcher-trigger.js';
import type { SelectOption } from './select.js';

export type { WorkspaceSwitcherLabels };

export type WorkspaceSwitcherProps = {
  labels: WorkspaceSwitcherLabels;
  /** الاسم التجاري والفرع الظاهران على الزر — مترجمان من المستدعي. */
  businessName: string;
  branchName: string;
  companyValue: string;
  businessValue: string;
  branchValue: string;
  companyOptions: readonly SelectOption[];
  businessOptions: readonly SelectOption[];
  branchOptions: readonly SelectOption[];
  /** حالة التعطيل قرار المستدعي (لا شركة مختارة يعني نشاطًا معطلًا) — الكيت لا يستنتجها. */
  companyDisabled?: boolean;
  businessDisabled?: boolean;
  branchDisabled?: boolean;
  onCompanyChange: (value: string) => void;
  onBusinessChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  /** إشعار بالفتح والإغلاق؛ الإغلاق بالهروب يرجع التركيز إلى الزر تلقائيًا. */
  onOpenChange?: (open: boolean) => void;
  /** يغيّره المستضيف عند كل انتقال فتُغلق القائمة دون إعادة بناء زرها؛ الإغلاق به لا يستدعي onOpenChange. */
  resetKey?: string | undefined;
  className?: string;
};

/**
 * مبدّل مساحة العمل: زر يعرض الاسم التجاري والفرع ويفتح قائمة شركة/نشاط/فرع
 * من مبدّلات الكيت؛ كل القيم والخيارات والتعطيل والتغييرات قرار المستدعي،
 * والكيت لا يقرأ جلسة ولا مسارًا ولا يملك نصًا.
 */
export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [seenResetKey, setSeenResetKey] = useState(props.resetKey);
  if (seenResetKey !== props.resetKey) {
    setSeenResetKey(props.resetKey);
    setOpen(false);
  }
  return (
    <Popover.Root
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChange?.(next);
      }}
    >
      <Popover.Trigger asChild>
        <WorkspaceSwitcherTrigger
          businessName={props.businessName}
          branchName={props.branchName}
          className={props.className}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <WorkspaceSwitcherContent
          id={id}
          labels={props.labels}
          company={{
            value: props.companyValue,
            options: props.companyOptions,
            disabled: props.companyDisabled,
            onValueChange: props.onCompanyChange,
          }}
          business={{
            value: props.businessValue,
            options: props.businessOptions,
            disabled: props.businessDisabled,
            onValueChange: props.onBusinessChange,
          }}
          branch={{
            value: props.branchValue,
            options: props.branchOptions,
            disabled: props.branchDisabled,
            onValueChange: props.onBranchChange,
          }}
        />
      </Popover.Portal>
    </Popover.Root>
  );
}
