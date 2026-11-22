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

/**
 * الشريط السفلي 64px لروابط صفحات الهاتف داخل معلم تنقّل مسمّى؛ خانة العدّاد
 * أو علامة الحالة مطلقة عند ركن النهاية العلوي حتى لا تزحزح النص،
 * والمدخل الإضافي زرّ يبلّغ.
 */
export function BottomNav({ items, labels, extra, onNavigate, className }: BottomNavProps) {
  return (
    <nav
      aria-label={labels.label}
      className={cn('flex h-16 items-stretch border-t border-border bg-card', className)}
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
          onClick={onNavigate ? () => onNavigate(item) : undefined}
          className={cn(
            CELL_CLASS,
            item.current
              ? 'font-semibold text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.icon ? (
            <span
              className={cn(
                'flex h-7 w-13 items-center justify-center rounded-full',
                item.current && 'bg-secondary',
              )}
            >
              {item.icon}
            </span>
          ) : null}
          <span className="min-w-0 max-w-full truncate">{item.label}</span>
          {/* العلامة مطلقة عند ركن النهاية العلوي، مكان العدّاد، وتمتد نحو البداية: سطر ثالث
              تحت الأيقونة يتجاوز ارتفاع الشريط 64px، ووضعها بجانب الاسم يقصّها في خانة
              هاتف عرضها نحو 62px. المدخل تحت التطوير لا عدّاد له، فالعلامة تحل محله. */}
          {item.status ? (
            <span className="absolute end-0.5 top-0.5 max-w-[calc(100%-0.25rem)] truncate rounded-full border border-border bg-card px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
              {item.status}
            </span>
          ) : item.count ? (
            <span className={cn(shellNavCountClass, 'absolute end-2 top-1')}>{item.count}</span>
          ) : null}
        </a>
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
