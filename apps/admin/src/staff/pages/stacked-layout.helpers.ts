import { within } from '@testing-library/react';

/** كرت القائمة: الإطار لا يحمل landmark، فنصل إليه من عنصر بداخله بصنفه. */
export function cardOf(element: HTMLElement): HTMLElement {
  return element.closest('.rounded-card') as HTMLElement;
}

export function follows(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** تسميات خلايا صف مكدّس بالترتيب؛ null لخلية بلا تسمية. */
export function cellLabels(row: HTMLElement): (string | null)[] {
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.getAttribute('data-cell-label'));
}

/** نصوص ترويسات الجدول بالترتيب، كما يقرؤها قارئ الشاشة. */
export function headerTexts(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole('columnheader')
    .map((header) => header.textContent ?? '');
}
