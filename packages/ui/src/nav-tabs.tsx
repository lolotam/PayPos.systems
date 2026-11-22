import { cn } from './shared/cn.js';
import { shellNavCountClass, shellNavLinkClass, type ShellNavItem } from './shell-nav-item.js';

export type NavTabsLabels = {
  /** الاسم المتاح لمعلم التنقّل. */
  label: string;
};

export type NavTabsProps = {
  items: readonly ShellNavItem[];
  labels: NavTabsLabels;
  /** إشعار بالاختيار للاتصال؛ التنقّل نفسه يجري عبر `href` والكيت لا يمنعه. */
  onNavigate?: (item: ShellNavItem) => void;
  className?: string;
};

// صف تبويب 48px بمؤشر تسطير بلون النداء يتحرك للعنصر الحالي، ويتمرر داخل نفسه
// لما يزيد عدد العناصر عن العرض، وشرائط التمرير مخفية كما في النموذج.
const TAB_CLASS =
  'relative h-12 px-4 after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:origin-center after:scale-x-0 after:rounded-t-sm after:bg-cta after:content-[""] after:transition-transform after:duration-200 motion-reduce:after:transition-none';

/**
 * صف تبويبات روابط صفحات داخل معلم تنقّل مسمّى؛ الحالة الحالية يصنّفها المستدعي
 * على العنصر، والكيت لا يقرأ المسار ولا يملك أي نص.
 */
export function NavTabs({ items, labels, onNavigate, className }: NavTabsProps) {
  return (
    <nav aria-label={labels.label} className={cn('min-w-0 border-b border-border', className)}>
      <ul className="m-0 flex min-w-0 list-none items-center gap-1 overflow-x-auto p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <li key={item.id} className="max-w-48 min-w-0 shrink-0">
            <a
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              onClick={onNavigate ? () => onNavigate(item) : undefined}
              className={cn(
                shellNavLinkClass,
                TAB_CLASS,
                item.current
                  ? 'font-semibold text-foreground after:scale-x-100'
                  : 'text-muted-foreground hover:text-foreground',
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
