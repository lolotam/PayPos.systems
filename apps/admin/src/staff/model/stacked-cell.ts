import type { Cell } from '@tanstack/react-table';
import { isValidElement, type ReactNode } from 'react';

// عنصر المكوّن (دالة أو memo) قد يرسم لا شيء ولا نعرف ذلك قبل الرسم، فنعدّه محتوى؛
// أما العناصر العادية (span وdiv والأجزاء) فمحتواها أبناؤها، وبهذا لا تحمل الخلية
// التي فيها غلاف فارغ فقط تسمية ولا حشوة.
function hasStackedContent(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean' || node === '') {
    return false;
  }
  if (Array.isArray(node)) return node.some((child: ReactNode) => hasStackedContent(child));
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return typeof node.type === 'string' || typeof node.type === 'symbol'
      ? hasStackedContent(node.props.children)
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
): StackedCellContent {
  const render = cell.column.columnDef.cell;
  const node = (typeof render === 'function' ? render(cell.getContext()) : render) as ReactNode;
  if (!hasStackedContent(node)) return { label: undefined, content: null };
  const header = cell.column.columnDef.header;
  return {
    label: !unlabelled && typeof header === 'string' ? header : undefined,
    content: node,
  };
}
