import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Fragment, type ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { StackedTable } from './stacked-table';

type Row = { id: string; name: string; note: string | null; count: number; extra: ReactNode };

const columns: ColumnDef<Row>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  { id: 'note', header: 'Note', accessorKey: 'note' },
  { id: 'count', header: 'Count', accessorKey: 'count' },
  { id: 'extra', header: 'Extra', cell: ({ row }) => row.original.extra },
  { id: 'actions', header: 'Actions', cell: () => <button type="button">Open</button> },
];

function Harness({ rows, renderHeader }: { rows: Row[]; renderHeader?: boolean }) {
  'use no memo';
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <StackedTable<Row>
      table={table}
      unlabelled={['actions']}
      {...(renderHeader
        ? { renderHeader: (header) => <th key={header.id}>custom {header.id}</th> }
        : {})}
    />
  );
}

function row(overrides: Partial<Row> = {}): Row {
  return { id: 'r1', name: 'Synthetic', note: 'A note', count: 0, extra: 'More', ...overrides };
}

function cells() {
  return within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
}

afterEach(cleanup);

it('labels every cell that has content with its header, but not the first cell or an unlabelled column', () => {
  render(<Harness rows={[row()]} />);
  expect(cells().map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Note',
    'Count',
    'Extra',
    null,
  ]);
  expect(cells()[2]?.textContent).toBe('0');
});

it('gives no label and no content to a null value, an empty string and a wrapper with nothing inside', () => {
  const empty = <span className="block">{null}</span>;
  render(<Harness rows={[row({ note: null, extra: empty })]} />);
  const [, note, , extra] = cells();
  expect(note?.hasAttribute('data-cell-label')).toBe(false);
  expect(extra?.hasAttribute('data-cell-label')).toBe(false);
  expect(extra?.childElementCount).toBe(0);
  expect(extra?.className).toContain('max-[599.99px]:empty:py-0');
});

it('labels a cell whose content sits in a fragment or a wrapper element', () => {
  render(
    <Harness
      rows={[
        row({
          extra: (
            <Fragment>
              {null}
              <span>
                <b>Inner</b>
              </span>
            </Fragment>
          ),
        }),
      ]}
    />,
  );
  expect(cells()[3]?.getAttribute('data-cell-label')).toBe('Extra');
});

it('keeps explicit table roles and the header row, and accepts a custom header', () => {
  render(<Harness rows={[row()]} renderHeader />);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getAllByRole('rowgroup')).toHaveLength(2);
  expect(screen.getByText('custom name')).toBeTruthy();
});

it('keeps and labels a cell that holds an image, a form field or a named wrapper, though none has children', () => {
  render(
    <>
      <Harness rows={[row({ extra: <img alt="Synthetic portrait" src="synthetic.png" /> })]} />
      <Harness rows={[row({ extra: <input aria-label="Synthetic field" /> })]} />
      <Harness rows={[row({ extra: <span aria-label="Synthetic icon" role="img" /> })]} />
    </>,
  );
  const extras = screen
    .getAllByRole('row')
    .filter((_, index) => index % 2 === 1)
    .map((tableRow) => within(tableRow).getAllByRole('cell')[3] as HTMLElement);
  expect(extras).toHaveLength(3);
  for (const cell of extras) {
    expect(cell.getAttribute('data-cell-label')).toBe('Extra');
    expect(cell.childElementCount).toBe(1);
  }
  expect(
    within(extras[0] as HTMLElement).getByRole('img', { name: 'Synthetic portrait' }),
  ).toBeTruthy();
  expect(within(extras[1] as HTMLElement).getByLabelText('Synthetic field')).toBeTruthy();
  expect(
    within(extras[2] as HTMLElement).getByRole('img', { name: 'Synthetic icon' }),
  ).toBeTruthy();
});
