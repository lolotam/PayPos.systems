import { DropdownMenu } from 'radix-ui';

const SEPARATOR_CLASS = 'my-1 h-px bg-border';

/**
 * كتلة الاسم والبريد أعلى قائمة الحساب. النصان يُقصّان داخل العرض المسقوف، فيحمل كلٌّ منهما `title` بنصه
 * الكامل ليُقرأ ما قُصّ؛ غياب الاثنين يُسقط الكتلة وفاصلها.
 */
export function AccountMenuIdentity({ name, email }: { name?: string; email?: string }) {
  if (!name && !email) return null;
  return (
    <>
      <div className="flex flex-col gap-0.5 px-3 py-2">
        {name ? (
          <span title={name} className="truncate text-sm font-semibold">
            {name}
          </span>
        ) : null}
        {email ? (
          <span dir="ltr" title={email} className="truncate text-xs text-muted-foreground">
            {email}
          </span>
        ) : null}
      </div>
      <DropdownMenu.Separator className={SEPARATOR_CLASS} />
    </>
  );
}
