import type { Cell } from '@tanstack/react-table';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

// عنصر المكوّن (دالة أو memo) قد يرسم لا شيء ولا نعرف ذلك قبل الرسم، فنعدّه محتوى.
// ندخل في الأجزاء وأغلفة التخطيط المعروفة وحدها، وبهذا لا تحمل الخلية التي فيها غلاف فارغ فقط
// تسمية ولا حشوة؛ أما أي عنصر آخر (صورة، حقل، أيقونة، رابط) أو غلاف له اسم ظاهر لقارئ الشاشة
// فمحتوى حتى لو بلا أبناء، كي لا تُمحى خلية تعرضه.
const LAYOUT_WRAPPERS = new Set([
  'div',
  'span',
  'p',
  'section',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'strong',
  'em',
  'b',
  'bdi',
]);

const ACCESSIBLE_NAME_PROPS = ['aria-label', 'aria-labelledby', 'title', 'role'] as const;

function isTransparentWrapper(element: ReactElement<Record<string, unknown>>): boolean {
  if (typeof element.type === 'symbol') return true;
  if (typeof element.type !== 'string' || !LAYOUT_WRAPPERS.has(element.type)) return false;
  return ACCESSIBLE_NAME_PROPS.every((name) => element.props[name] === undefined);
}

function hasStackedContent(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean' || node === '') {
    return false;
  }
  if (Array.isArray(node)) return node.some((child: ReactNode) => hasStackedContent(child));
  if (isValidElement<Record<string, unknown>>(node)) {
    return isTransparentWrapper(node)
      ? hasStackedContent(node.props['children'] as ReactNode)
      : true;
  }
  return true;
}

export type StackedCellContent = {
  /** تسمية العمود فوق القيمة في الصف المكدّس؛ غائبة للخلية الأولى والإجراءات والخلية الفارغة. */
  label: string | undefined;
  /** محتوى الخلية؛ null إذا لم تحمل شيئًا كي تنكمش الخلية بدل أن تترك غلافًا فارغًا. */
  content: ReactNode;
};

/**
 * يحسب تسمية الخلية ومحتواها للصف المكدّس.
 * تعريفات الأعمدة هنا دوال عادية بلا hooks، فنستدعي دالة الخلية مباشرة لنعرف إن كان فيها محتوى.
 */
export function stackedCellContent<T>(
  cell: Cell<T, unknown>,
  unlabelled: boolean,
  labelOverride?: string,
): StackedCellContent {
  const render = cell.column.columnDef.cell;
  const node = (typeof render === 'function' ? render(cell.getContext()) : render) as ReactNode;
  if (!hasStackedContent(node)) return { label: undefined, content: null };
  const header = cell.column.columnDef.header;
  return {
    label: unlabelled
      ? undefined
      : (labelOverride ?? (typeof header === 'string' ? header : undefined)),
    content: node,
  };
}
