import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DataTableFrame } from '../data-table-frame.js';
import { DirectionProvider } from '../direction-provider.js';

function frame(props: { stacked?: boolean; filters?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <DirectionProvider dir="rtl">
      <DataTableFrame
        title="Services"
        action={<button type="button">Add</button>}
        filters={props.filters}
        footer={props.footer}
        {...(props.stacked === undefined ? {} : { stacked: props.stacked })}
      >
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Hair cut</td>
              <td data-cell-label="Price">12.500</td>
            </tr>
          </tbody>
        </table>
      </DataTableFrame>
    </DirectionProvider>
  );
}

it("keeps today's output for title, action and the scrolling table area", () => {
  render(frame({}));
  expect(screen.getByRole('button', { name: 'Add' }).parentElement?.className).toContain('ms-auto');
  const heading = screen.getByRole('heading', { name: 'Services' });
  expect(heading.parentElement?.className).toContain('border-b');
  const table = screen.getByRole('table');
  // منطقة التمرير تحيط بالجدول بكل أصناف الخلايا المعتادة، وبلا أصناف التكديس
  const scrollArea = table.parentElement as HTMLElement;
  expect(scrollArea.className).toContain('[&_table]:w-full');
  // التوكيد على الحدّ الحقيقي 599.99px — التحقق من 599px وحده كان يمرّ فراغًا
  expect(scrollArea.className).not.toContain('max-[599.99px]');
});

it('hides the filter and footer bars when nothing is supplied', () => {
  const { container } = render(frame({}));
  const bars = container.querySelectorAll('.empty\\:hidden');
  expect(bars).toHaveLength(2);
  expect(screen.queryByText('All categories')).toBeNull();
});

it('shows a supplied filter above the table and a supplied footer below it', () => {
  render(
    frame({
      filters: <select aria-label="Category" />,
      footer: <button type="button">Next</button>,
    }),
  );
  const table = screen.getByRole('table');
  const filter = screen.getByRole('combobox', { name: 'Category' });
  const footerButton = screen.getByRole('button', { name: 'Next' });
  expect(filter.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    table.compareDocumentPosition(footerButton) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('leaves no bordered bar when the filter renders nothing', () => {
  // مثال القائمة: فلتر التصنيفات يرجع null لما يفشل تحميل التصنيفات — نفس نتيجة عدم التمرير
  const { container } = render(frame({ filters: null, footer: <>{false}</> }));
  expect(container.querySelectorAll('.empty\\:hidden')).toHaveLength(2);
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('opts in to stacked rows with per-cell labels, and stays tabular without the flag', () => {
  const { container: stackedContainer } = render(frame({ stacked: true }));
  const stackedArea = stackedContainer.querySelector('[class*="max-[599.99px]"]') as HTMLElement;
  expect(stackedArea.className).toContain('max-[599.99px]:[&_table]:block');
  expect(stackedArea.className).toContain(
    'max-[599.99px]:[&_tbody_td[data-cell-label]]:before:content-[attr(data-cell-label)]',
  );
  // الخلية بلا تسمية (الأولى) لا تحمل صنف التسمية على إطلاقًا — التسمية على الخلية نفسها
  expect(stackedArea.querySelector('td[data-cell-label="Price"]')).not.toBeNull();

  const { container: plainContainer } = render(frame({}));
  const plainArea = plainContainer.querySelector('table')?.parentElement as HTMLElement | undefined;
  expect(plainArea?.className).not.toContain('max-[599.99px]');
});

it('lets unbroken text wrap inside every stacked cell so no value forces sideways scrolling', () => {
  const { container } = render(frame({ stacked: true }));
  const stackedArea = container.querySelector('[class*="max-[599.99px]"]') as HTMLElement;
  // التفاف الكلمات الطويلة بلا فواصل داخل كل خلية مكدّسة
  expect(stackedArea.className).toContain('max-[599.99px]:[&_tbody_td]:[overflow-wrap:anywhere]');
  // والجدول غير المكدس لا يحصل عليها — لا تغيير في الشكل الحالي
  const { container: plainContainer } = render(frame({}));
  const plainArea = plainContainer.querySelector('table')?.parentElement as HTMLElement;
  expect(plainArea.className).not.toContain('[overflow-wrap:anywhere]');
});

it('sets no row background in stacked mode, so a selected row keeps its own highlight', () => {
  // قاعدة خلفية على 	body tr من الإطار أعلى تخصيصًا من صنف الصف نفسه، فكانت
  // تمسح تمييز الخدمة المختارة للتعديل تحت 600px؛ البطاقة تاخد خلفيتها من الكارت.
  const { container } = render(frame({ stacked: true }));
  const stackedArea = container.querySelector('[class*="max-[599.99px]"]') as HTMLElement;
  expect(stackedArea.className).not.toContain('[&_tbody_tr]:bg-');
});

it('keeps the stacked header reachable by assistive tech instead of removing it', () => {
  const { container } = render(frame({ stacked: true }));
  const stackedArea = container.querySelector('[class*="max-[599.99px]"]') as HTMLElement;
  // الترويسة مخفية بصريًا (sr-only) لا محذوفة (hidden)، فتبقى في شجرة النفاذ
  // وتحفظ ارتباط العمود بخليته مع الأدوار الصريحة في ترميز المستدعي.
  expect(stackedArea.className).toContain('max-[599.99px]:[&_thead]:sr-only');
  expect(stackedArea.className).not.toContain('[&_thead]:hidden');
});
