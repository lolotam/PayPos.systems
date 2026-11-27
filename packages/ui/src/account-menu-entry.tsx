'use client';

import { DropdownMenu } from 'radix-ui';

import { LoaderCircle } from './icons.js';

/** مدخل قائمة الحساب كما يرسله المستدعي، مع حالته الاختيارية. */
export type AccountMenuEntry = {
  id: string;
  label: string;
  /** عنوان وجهة المدخل الرابطي؛ غيابه يجعل المدخل زرًا يبلّغ `onSelect`. */
  href?: string;
  onSelect?: () => void;
  /** حالة انتظار (مثل خروج جارٍ): المدخل يتعطل ويظهر مؤشر تحميل يتوقف تحت reduced motion. */
  pending?: boolean;
  disabled?: boolean;
  /** اسم بديل يقرأه قارئ الشاشة بدل النص الظاهر (مثل «النمط الحالي»)؛ غيابه يبقي النص الظاهر. */
  ariaLabel?: string;
  /** مدخل الاختيار الحالي: يُنقل إلى `aria-current` على العنصر المعروض. */
  current?: boolean;
};

const ITEM_CLASS =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-interactive px-3 py-2 text-start text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

/**
 * صف مدخل واحد داخل قائمة الحساب: رابط لما يحمل عنوانًا، وزر يبلّغ `onSelect`
 * لما لا يحمل؛ حالة الانتظار تعطّل الصف وتشغّل مؤشر التحميل.
 */
export function AccountMenuEntryItem({ entry }: { entry: AccountMenuEntry }) {
  const disabled = entry.disabled === true || entry.pending === true;
  const pendingMark = entry.pending ? (
    <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
  ) : null;
  if (entry.href !== undefined) {
    return (
      <DropdownMenu.Item asChild disabled={disabled}>
        {/* حالة التعطيل تُسقط href نفسه لا الستايل فقط: الرابط بلا href لا يُفعِّله
            الضغط ولا Enter، حتى لو كان العنصر على التركيز لحظة تعطُّله. */}
        <a
          href={disabled ? undefined : entry.href}
          data-account-entry={entry.id}
          aria-label={entry.ariaLabel}
          aria-current={entry.current ? 'true' : undefined}
          className={ITEM_CLASS}
        >
          {pendingMark}
          <span className="truncate">{entry.label}</span>
        </a>
      </DropdownMenu.Item>
    );
  }
  return (
    <DropdownMenu.Item
      data-account-entry={entry.id}
      disabled={disabled}
      aria-label={entry.ariaLabel}
      aria-current={entry.current ? 'true' : undefined}
      onSelect={() => entry.onSelect?.()}
      className={ITEM_CLASS}
    >
      {pendingMark}
      <span className="truncate">{entry.label}</span>
    </DropdownMenu.Item>
  );
}
