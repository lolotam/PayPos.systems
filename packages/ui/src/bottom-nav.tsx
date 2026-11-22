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
  onPress: () => void;
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
 * مطلقة عند الطرف المنطقي العلوي حتى لا تزحزح النص، والمدخل الإضافي زرّ يبلّغ.
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
          {item.count ? (
            <span className={cn(shellNavCountClass, 'absolute end-2 top-1')}>{item.count}</span>
          ) : null}
        </a>
      ))}
      {extra ? (
        <button
          type="button"
          onClick={extra.onPress}
          className={cn(CELL_CLASS, 'text-muted-foreground hover:text-foreground')}
        >
          {extra.label}
        </button>
      ) : null}
    </nav>
  );
}
