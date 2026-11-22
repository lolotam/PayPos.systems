import { cn } from './shared/cn.js';
import { shellNavCountClass, type ShellNavItem } from './shell-nav-item.js';

/** عنصر بطاقة محور: عنصر تنقّل مع وصف من سطر واحد يجعل الكرت كله هدف الرابط. */
export type HubCardItem = ShellNavItem & {
  /** وصف سطر واحد — يُقصّ بنقطة حذف ولا يكسر السطر. */
  description: string;
};

export type HubCardProps = {
  item: HubCardItem;
  /** إشعار بالاختيار للاتصال؛ التنقّل نفسه يجري عبر `href` والكيت لا يمنعه. */
  onNavigate?: (item: HubCardItem) => void;
  className?: string;
};

// الكرت كله رابط واحد بارتفاع 44px على الأقل، بحلقة تركيز ورفعة استعراض تتوقف
// تحت prefers-reduced-motion. بلا nowrap على مستوى الكرت حتى يمكنه الانكماش
// داخل عموده؛ القصّ يتولّاه العنوان والوصف بنقطة حذف كلٌّ في سطره.
const CARD_CLASS =
  'flex min-h-11 min-w-0 max-w-full items-start gap-4 rounded-card border border-border bg-card p-5 text-start text-sm font-normal transition-[border-color,translate] hover:-translate-y-0.5 hover:border-primary motion-reduce:translate-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * بطاقة محور لصفحة نظرة عامة: أيقونة وعنوان ووصف سطر واحد، والكرت كله هدف
 * رابط واحد؛ العدّاد وعلامة «قريبًا» بجانب العنوان فقط لما يرسلهما المستدعي.
 */
export function HubCard({ item, onNavigate, className }: HubCardProps) {
  return (
    <a
      href={item.href}
      aria-current={item.current ? 'page' : undefined}
      onClick={onNavigate ? () => onNavigate(item) : undefined}
      className={cn(CARD_CLASS, className)}
    >
      {item.icon ? (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-interactive bg-success-soft text-primary">
          {item.icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-semibold text-foreground">{item.label}</span>
          {item.count ? (
            <span className={cn(shellNavCountClass, 'shrink-0')}>{item.count}</span>
          ) : null}
          {item.status ? (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {item.status}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 truncate text-[13px] font-normal text-muted-foreground">
          {item.description}
        </span>
      </span>
    </a>
  );
}
