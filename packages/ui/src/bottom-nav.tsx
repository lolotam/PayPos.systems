import type { MouseEvent } from 'react';
import { cn } from './shared/cn.js';
import { shellNavCountClass, type ShellNavItem } from './shell-nav-item.js';

export type BottomNavLabels = {
  /** الاسم المتاح لمعلم التنقّل. */
  label: string;
};

/** مدخل إضافي (مثل «المزيد») يبلّغ المستدعي بالضغطة؛ الكيت لا يبني الورقة التي تفتح. */
export type BottomNavExtra = {
  id: string;
  label: string;
  /** المدخل يضم الصفحة الحالية؛ يُعلَّم بـ aria-current وبخط أثقل فلا يعتمد على اللون وحده. */
  current?: boolean;
  /** يستلم الضغطة ليعرف المستدعي الزر الذي فتح الورقة فيعيد إليه التركيز عند الإغلاق. */
  onPress: (event: MouseEvent<HTMLButtonElement>) => void;
};

export type BottomNavProps = {
  items: readonly ShellNavItem[];
  labels: BottomNavLabels;
  /** مدخل زرّي إضافي بعد الروابط — الخمسة مداخل حدًا أقصى يحددها المستدعي. */
  extra?: BottomNavExtra;
  /** إشعار بالاختيار للاتصال؛ التنقّل نفسه يجري عبر `href` والكيت لا يمنعه. */
  onNavigate?: (item: ShellNavItem) => void;
  className?: string;
};

const CELL_CLASS =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-interactive px-1 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function iconWrapperClass(item: ShellNavItem) {
  if (!item.status) return 'h-7 w-13';
  return item.count ? 'me-5 h-5 w-7 [&_svg]:size-4' : 'h-5 w-10 [&_svg]:size-4';
}

function BottomNavEntry({
  item,
  onNavigate,
}: {
  item: ShellNavItem;
  onNavigate?: (item: ShellNavItem) => void;
}) {
  return (
    <a
      href={item.href}
      aria-current={item.current ? 'page' : undefined}
      onClick={onNavigate ? () => onNavigate(item) : undefined}
      className={cn(
        CELL_CLASS,
        item.status && 'gap-0.5 py-0.5',
        item.current ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {item.icon ? (
        <span
          className={cn(
            'flex items-center justify-center rounded-full',
            iconWrapperClass(item),
            item.current && 'bg-secondary',
          )}
        >
          {item.icon}
        </span>
      ) : item.status && item.count ? (
        <span aria-hidden="true" className="h-5 shrink-0" />
      ) : null}
      <span className={cn('min-w-0 max-w-full truncate', item.status && 'leading-3.5')}>
        {item.label}
      </span>
      {/* علامة الحالة في التدفق أسفل الاسم حتى لا تغطي الأيقونة ولا تقصّها خانة الهاتف
          الضيقة (نحو 62px)، مع تصغير غلاف الأيقونة وإحكام التباعد ليبقى الشريط 64px.
          العدّاد مستقل في الركن العلوي فلا يُسقط إذا جمع المدخل بين العلامة والعدّاد. */}
      {item.status ? (
        <>
          {' '}
          <span className="max-w-full shrink-0 truncate rounded-full border border-border bg-card px-1.5 py-0 text-[10px] leading-3.5 font-medium text-muted-foreground">
            {item.status}
          </span>
        </>
      ) : null}
      {item.count ? (
        <>
          {' '}
          <span
            className={cn(
              shellNavCountClass,
              item.status ? 'absolute end-0.5 top-0.5' : 'absolute end-2 top-1',
            )}
          >
            {item.count}
          </span>
        </>
      ) : null}
    </a>
  );
}

/**
 * الشريط السفلي 64px لروابط صفحات الهاتف داخل معلم تنقّل مسمّى؛ خانة العدّاد مطلقة
 * عند ركن النهاية العلوي وعلامة الحالة تُعرض في التدفق أسفل الاسم مع حجز مساحة غير
 * متداخلة للأيقونة والاسم والعلامة ضمن 64px، والمدخل الإضافي زرّ يبلّغ.
 */
export function BottomNav({ items, labels, extra, onNavigate, className }: BottomNavProps) {
  return (
    <nav
      aria-label={labels.label}
      className={cn('flex h-16 items-stretch border-t border-border bg-card', className)}
    >
      {items.map((item) => (
        <BottomNavEntry
          key={item.id}
          item={item}
          {...(onNavigate === undefined ? {} : { onNavigate })}
        />
      ))}
      {extra ? (
        <button
          type="button"
          onClick={extra.onPress}
          aria-current={extra.current ? 'true' : undefined}
          className={cn(
            CELL_CLASS,
            extra.current
              ? 'font-semibold text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {extra.label}
        </button>
      ) : null}
    </nav>
  );
}
