import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { GroupOverviewPage } from './group-overview-page';

it('draws a heading per sub-menu and a card per page, with the Soon mark', () => {
  render(
    <GroupOverviewPage
      overview={{
        label: 'People',
        description: 'Employees and attendance.',
        sections: [
          {
            id: 'employees',
            label: 'Employees',
            items: [
              { id: 'employees', label: 'Employees', href: '/staff', description: 'Employees' },
              {
                id: 'phones',
                label: 'Employee phones',
                href: '/soon/employee-phones',
                description: 'Employees',
                status: 'Soon',
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy();
  const section = screen.getByRole('region', { name: 'Employees' });
  expect(
    within(section)
      .getByRole('link', { name: /^Employees/ })
      .getAttribute('href'),
  ).toBe('/staff');
  expect(within(section).getByRole('link', { name: /Employee phones/ }).textContent).toContain(
    'Soon',
  );
});
