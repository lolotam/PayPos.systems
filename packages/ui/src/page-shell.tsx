import { Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react';

import { cn } from './shared/cn.js';

export type PageShellLayout = 'list' | 'form' | 'two-column';

export type PageShellProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** قوائم ولوحات بعرض 1200px كحد أقصى؛ نماذج بعرض 840px؛ ثنائي الأعمدة بعرض القوائم. */
  layout?: PageShellLayout;
  children?: ReactNode;
  /** كتلة العمود الرئيسي في التخطيط ثنائي الأعمدة (2 من 3 أعمدة من 1024px). */
  main?: ReactNode;
  /** كتلة العمود الجانبي (1 من 3)؛ الكتلة الوحيدة، رئيسية أو جانبية، تقع في العمود الرئيسي. */
  side?: ReactNode;
};

const WIDTH_CLASS = {
  list: 'max-w-[1200px]',
  form: 'max-w-[840px]',
  'two-column': 'max-w-[1200px]',
} as const;

// سقف وصف الترويسة 65 حرفًا يطبَّق هنا لا في الترويسة نفسها، ليبقى شكل الترويسات
// الـ24 خارج القوالب كما هو إلى أن تنقلها 074-7/074-9 إلى القوالب؛ والقصّ بسطر واحد
// بنقطة حذف يمنع لفّ الوصف تحت إجراء الترويسة.
const DESCRIPTION_CAP_CLASS =
  '[&_[data-page-header-description]]:max-w-[65ch] [&_[data-page-header-description]]:truncate';

const COLUMN_CLASS = 'flex min-w-0 flex-col gap-4 md:gap-6';

// قاعدة وجود موحدة لخانتي الرئيسي والجانبي: تتجاهل الغائب والمنطقي والمصفوفات والفراغ الفارغ وتُبقي الرقم 0.
function hasSlotContent(node: ReactNode): boolean {
  if (node === undefined || node === null || typeof node === 'boolean' || node === '') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(hasSlotContent);
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) {
    return hasSlotContent(node.props.children);
  }
  return true;
}

/**
 * إطار الصفحة المشترك: يملك العرض المركزي وفجوة الأقسام فقط، لا يحرك حشوة الصفحة —
 * عشان لا تتحشّر صفحة مرتين قبل أن تأتي حشوة القوالب مع 074-7.
 */
export function PageShell({
  layout = 'list',
  main,
  side,
  className,
  children,
  ...props
}: PageShellProps) {
  if (layout !== 'two-column') {
    return (
      <div
        data-page-shell={layout}
        className={cn(
          'mx-auto flex w-full flex-col gap-4 text-start md:gap-6',
          WIDTH_CLASS[layout],
          DESCRIPTION_CAP_CLASS,
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
  // القاعدة الواحدة لخانتي العمودين: الغائب والمنطقي والمصفوفات الفاضية والفراغ الفارغ
  // ما يبنيوش غلاف عمود، والقيمة الصفرية `0` محتوى حقيقي. غلاف فاضي في الخانة الجانبية
  // معناه فجوة تحت 1024px وطفل شبكة فارغ من 1024px.
  const hasMain = hasSlotContent(main);
  const hasSide = hasSlotContent(side);
  return (
    <div
      data-page-shell="two-column"
      className={cn(
        'mx-auto flex w-full flex-col gap-4 text-start md:gap-6',
        WIDTH_CLASS['two-column'],
        DESCRIPTION_CAP_CLASS,
        className,
      )}
      {...props}
    >
      {children}
      {/* خانتا العمودين لهما موضع React ثابت، فكتلة الجانبي لا يُعاد تركيبها لما تظهر
          كتلة الرئيسي أو تختفي وتحتفظ بحالتها الداخلية؛ ومن غير كتلة رئيسية تقع كتلة
          الجانبي وحدها في أول عمود (2fr) بترتيب الشبكة، فلا تُترك في الضيق. */}
      <div className={cn(COLUMN_CLASS, 'lg:grid lg:grid-cols-[2fr_1fr] lg:items-start lg:gap-6')}>
        {hasMain ? <div className={COLUMN_CLASS}>{main}</div> : null}
        {hasSide ? <div className={COLUMN_CLASS}>{side}</div> : null}
      </div>
    </div>
  );
}
