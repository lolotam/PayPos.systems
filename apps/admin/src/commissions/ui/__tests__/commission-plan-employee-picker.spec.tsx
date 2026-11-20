import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { CommissionPlanEmployeePicker } from '../commission-plan-employee-picker';
import { employeeItem } from '../../api/__tests__/plan-http';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const SARA = employeeItem('emp-1', 7, 'سارة', 'Sara');
const NADA = employeeItem('emp-2', 9, null, 'Nada');

function renderPicker(
  items: readonly unknown[],
  props: Partial<Parameters<typeof CommissionPlanEmployeePicker>[0]> = {},
) {
  return render(
    <CommissionPlanEmployeePicker
      items={items as never}
      hasNextPage={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      value=""
      onChange={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  state.locale = 'en';
});

it('shows the Arabic name when the locale is Arabic and the name exists', () => {
  state.locale = 'ar';
  renderPicker([SARA, NADA]);
  const options = screen.getAllByRole('option');
  expect(options[1]?.textContent).toBe('سارة — #7');
});

it('falls back to the English name when the Arabic name is missing', () => {
  state.locale = 'ar';
  renderPicker([NADA]);
  expect(screen.getAllByRole('option')[1]?.textContent).toBe('Nada — #9');
});

it('shows the English name and the employee number in the English locale', () => {
  renderPicker([SARA]);
  expect(screen.getAllByRole('option')[1]?.textContent).toBe('Sara — #7');
  expect(screen.queryByText('سارة')).toBeNull();
});

it('shows the placeholder before a choice and reports the chosen id', () => {
  const onChange = vi.fn();
  renderPicker([SARA], { onChange });
  const select = screen.getByLabelText(t('en', 'commissionPlanBuilder.pickerLabel'));
  expect((select as HTMLSelectElement).value).toBe('');
  expect(screen.getByText(t('en', 'commissionPlanBuilder.pickerPlaceholder'))).toBeTruthy();
  fireEvent.change(select, { target: { value: 'emp-1' } });
  expect(onChange).toHaveBeenCalledWith('emp-1');
});

it('offers load more only while the server has another page', () => {
  const onLoadMore = vi.fn();
  const view = renderPicker([SARA], { hasNextPage: true, loadingMore: false, onLoadMore });
  const button = screen.getByRole('button', { name: t('en', 'commissionPlanBuilder.loadMore') });
  fireEvent.click(button);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  view.rerender(
    <CommissionPlanEmployeePicker
      items={[SARA]}
      hasNextPage={false}
      loadingMore={false}
      onLoadMore={onLoadMore}
      value=""
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole('button', { name: t('en', 'commissionPlanBuilder.loadMore') }),
  ).toBeNull();
});

it('disables load more while the next page is loading', () => {
  renderPicker([SARA], { hasNextPage: true, loadingMore: true });
  const button = screen.getByRole('button', {
    name: t('en', 'commissionPlanBuilder.loadMore'),
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

it('shows the empty state with no option and no free text', () => {
  renderPicker([]);
  expect(screen.getByText(t('en', 'commissionPlanBuilder.listEmpty'))).toBeTruthy();
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});
