import type { ComponentProps, ReactNode } from 'react';
import { Card } from './card/card.js';
import { cn } from './shared/cn.js';

export type DataTableFrameProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode;
  action?: ReactNode;
  /** منطقة تصفية اختيارية فوق الجدول داخل نفس الكرت؛ محتوى لا يرسم شيئًا يترك لا شريط ولا حدود. */
  filters?: ReactNode;
  /** منطقة تذييل اختيارية تحت الجدول (أزرار الصفحات مثلًا)؛ محتوى فارغ لا يترك شريطًا. */
  footer?: ReactNode;
  /** صفوف مكدسة تحت 600px — اختياري لكل جدول: الخلية الأولى عنوان البطاقة وما بعدها قيمة فوقها تسمية عمودها. */
  stacked?: boolean;
};

// عناصر مكدّسة الصفوف: كلها تحت 600px (الحدّ 599.99px يشمل العروض الكسورية
// تحت الستين)، والخلية لا تعرض تسميتها إلا إذا حملت data-cell-label —
// فالخلية الأولى تظل عنوان البطاقة بلا تسمية فارغة فوقها. التفاف النص الطويل
// بلا فواصل داخل كل خلية مكدّسة (ويرثه النص داخل الأغلفة المرنة)، والترويسة
// تبقى مخفية بصريًا لا محذوفة كي تحفظ الأدوار الصريحة ارتباط العمود بخليته لقارئ الشاشة.
const STACKED_CLASS = [
  'max-[599.99px]:[&_table]:block',
  'max-[599.99px]:[&_thead]:sr-only',
  'max-[599.99px]:[&_tbody]:block',
  'max-[599.99px]:[&_tbody_tr]:mb-2',
  'max-[599.99px]:[&_tbody_tr]:block',
  'max-[599.99px]:[&_tbody_tr]:rounded-card',
  'max-[599.99px]:[&_tbody_tr]:border',
  'max-[599.99px]:[&_tbody_tr]:p-2',
  'max-[599.99px]:[&_tbody_tr:last-child]:mb-0',
  'max-[599.99px]:[&_tbody_td]:block',
  'max-[599.99px]:[&_tbody_td]:[overflow-wrap:anywhere]',
  'max-[599.99px]:[&_tbody_td]:px-0',
  'max-[599.99px]:[&_tbody_td]:py-1.5',
  'max-[599.99px]:[&_tbody_td:first-child]:text-base',
  'max-[599.99px]:[&_tbody_td:first-child]:font-semibold',
  'max-[599.99px]:[&_tbody_td[data-cell-label]]:before:content-[attr(data-cell-label)]',
  'max-[599.99px]:[&_tbody_td[data-cell-label]]:before:block',
  'max-[599.99px]:[&_tbody_td[data-cell-label]]:before:text-xs',
  'max-[599.99px]:[&_tbody_td[data-cell-label]]:before:font-medium',
  'max-[599.99px]:[&_tbody_td[data-cell-label]]:before:text-muted-foreground',
].join(' ');

/**
 * كرت إطار الجدول: شريط عنوان اختياري، منطقتا تصفية وتذييل فارغتان بلا أثر،
 * وجدول يتمرر أفقيًا داخل الكرت — أو يتحول لبطاقات مكدسة عند تفعيل opt-in.
 */
export function DataTableFrame({
  title,
  action,
  filters,
  footer,
  stacked = false,
  children,
  className,
  ...props
}: DataTableFrameProps) {
  return (
    <Card className={cn('min-w-0 overflow-hidden', className)} {...props}>
      {title || action ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          {title ? <h2 className="font-bold">{title}</h2> : null}
          {action ? <div className="ms-auto">{action}</div> : null}
        </div>
      ) : null}
      <div className="border-b border-border p-4 empty:hidden">{filters}</div>
      <div
        className={cn(
          'overflow-x-auto [&_table]:w-full [&_table]:text-start [&_thead]:bg-secondary [&_th]:px-4 [&_th]:py-3 [&_th]:text-start [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-4 [&_td]:py-3 [&_tbody_tr]:border-t [&_tbody_tr]:border-border',
          stacked ? STACKED_CLASS : '',
        )}
      >
        {children}
      </div>
      <div className="border-t border-border p-4 empty:hidden">{footer}</div>
    </Card>
  );
}
