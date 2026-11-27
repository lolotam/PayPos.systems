'use client';

import { DropdownMenu } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { AccountMenuEntryItem, type AccountMenuEntry } from './account-menu-entry.js';
import { AccountMenuIdentity } from './account-menu-identity.js';
import { UserRound } from './icons.js';
import { cn } from './shared/cn.js';

export type { AccountMenuEntry };

export type AccountMenuLabels = {
  /** الاسم المتاح لزر الحساب الأيقوني. */
  label: string;
};

export type AccountMenuProps = {
  labels: AccountMenuLabels;
  /** الاسم والبريد الظاهران أعلى القائمة؛ غيابهما يفتح القائمة بلا كتلة هوية. */
  name?: string;
  email?: string;
  /** المداخل بترتيبها المعطى — كل نص فيها مترجم من المستدعي، ومنها ما يخص الوضع والمظهر. */
  entries: readonly AccountMenuEntry[];
  /** يغيّره المستضيف عند كل انتقال فتُغلق القائمة دون إعادة بناء زرها؛ الغياب لا يغيّر شيئًا. */
  resetKey?: string | undefined;
  /** أيقونة الزر بدل صورة المستخدم؛ الغياب يترك الصورة الافتراضية. */
  icon?: ReactNode;
  className?: string;
};

/**
 * قائمة الحساب: الاسم والبريد ثم المداخل بترتيبها المعطى، وباب مغلق بالهروب
 * يرجع التركيز إلى الزر؛ الكيت لا يقرأ جلسة ولا مسارًا، وكل نص من المستدعي.
 * لا خانات حرة بعد المداخل: عناصر Radix لا تصلها لوحة المفاتيح، وأي تحكم
 * إضافي (مثل مبدّل الوضع) يدخل كمدخل من المداخل في خطوة 074-7.
 */
export function AccountMenu({
  labels,
  name,
  email,
  entries,
  resetKey,
  icon,
  className,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    setOpen(false);
  }
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={labels.label}
          title={labels.label}
          className={cn(
            'inline-flex size-11 items-center justify-center rounded-interactive text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            className,
          )}
        >
          {icon ?? <UserRound aria-hidden className="size-4" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        {/* ارتفاع القائمة محدود بالمساحة المتاحة من Radix مع تمرير داخلي، وعرضها
            مُسقوف بعرضه المتاح كي لا يوسّع بريد طويل بلا فواصل القائمة عن الشاشة. */}
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 min-w-56 max-w-[var(--radix-dropdown-menu-content-available-width)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-card border border-border bg-card p-1 text-card-foreground shadow-sm"
        >
          <AccountMenuIdentity {...(name ? { name } : {})} {...(email ? { email } : {})} />
          {entries.map((entry) => (
            <AccountMenuEntryItem key={entry.id} entry={entry} />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
