import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { SetScheduleInput } from '@pospay/contracts';
import { expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { ScheduleShiftFields } from './schedule-shift-fields';
import { ScheduleLimitContext } from '../model/schedule-form';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
function Fields({ limit }: { limit: number }) {
  const form = useForm<SetScheduleInput>({
    defaultValues: { week_start: '2026-10-03', expected_revision: 0, shifts: [] },
  });
  return (
    <ScheduleLimitContext value={limit}>
      <FormProvider {...form}>
        <ScheduleShiftFields day={0} pending={false} />
      </FormProvider>
    </ScheduleLimitContext>
  );
}
it.each([1, 3, 4])('disables Add at the effective limit %s', (limit) => {
  render(<Fields limit={limit} />);
  const add = screen.getByRole('button', {
    name: t('en', 'shell.schedule_add'),
  }) as HTMLButtonElement;
  for (let i = 0; i < limit; i++) {
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
  }
  expect(add.disabled).toBe(true);
  fireEvent.click(
    screen.getAllByRole('button', {
      name: t('en', 'shell.schedule_remove'),
    })[0] as HTMLButtonElement,
  );
  expect(add.disabled).toBe(false);
});
