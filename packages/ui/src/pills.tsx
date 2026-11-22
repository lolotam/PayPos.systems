import { cn } from './shared/cn.js';
import { shellNavCountClass, shellNavLinkClass, type ShellNavItem } from './shell-nav-item.js';

export type PillsLabels = {
  /** الاسم المتاح لمعلم التنقّل. */
  label: string;
};

export type PillsProps = {
  items: readonly ShellNavItem[];
  labels: PillsLabels;
  /** إشعار بالاختيار للاتصال؛ التنقّل نفسه يجري عبر `href` والكيت لا يمنعه. */
  onNavigate?: (item: ShellNavItem) => void;
  className?: string;
};

// حبة مستديرة بارتفاع 44px على الأقل؛ الحالية بخلفية اللون الرئيسي كما في النموذج.
const PILL_CLASS = 'min-h-11 px-3.5 text-[14px]';

/**
 * شريط حبوب لروابط صفحات مستوى فرعي داخل معلم تنقّل مسمّى؛ يلتف على سطور بدل
 * التمرير، والحالة الحالية من المستدعي ولا نص للكيت.
 */
export function Pills({ items, labels, onNavigate, className }: PillsProps) {
  return (
    <nav aria-label={labels.label} className={cn('min-w-0', className)}>
      <ul className="m-0 flex min-w-0 list-none flex-wrap items-center gap-2 p-0">
        {items.map((item) => (
          <li key={item.id} className="max-w-56 min-w-0">
            <a
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              onClick={onNavigate ? () => onNavigate(item) : undefined}
              className={cn(
                shellNavLinkClass,
                PILL_CLASS,
                item.current
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {item.icon}
              <span className="min-w-0 truncate">{item.label}</span>
              {item.count ? <span className={shellNavCountClass}>{item.count}</span> : null}
              {item.status ? (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {item.status}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
