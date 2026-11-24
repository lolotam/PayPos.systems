import { expect } from 'vitest';

/** كل عنصر تحكم داخل FilterField، وكل الحقول أبناء مباشرين لنفس FilterRow الملتف. */
export function expectOneWrappingRow(controls: HTMLElement[]) {
  const fields = controls.map((control) => control.closest<HTMLElement>('[data-filter-field]'));
  expect(fields.every((field) => field !== null)).toBe(true);
  const rows = new Set(fields.map((field) => field?.parentElement));
  expect(rows.size).toBe(1);
  const [row] = [...rows];
  expect(row?.hasAttribute('data-filter-row')).toBe(true);
  expect(row?.classList.contains('flex-wrap')).toBe(true);
  expect(new Set(fields).size).toBe(controls.length);
}
