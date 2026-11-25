import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { WorkspaceSwitcher } from '../workspace-switcher.js';

if (typeof window !== 'undefined') {
  window.Element.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => undefined;
  window.HTMLElement.prototype.releasePointerCapture = () => undefined;
}

const labels = {
  switcher: 'Workspaces',
  company: 'Company',
  business: 'Business',
  branch: 'Branch',
};
const companyOptions = [{ value: 'c1', label: 'One company' }];
const businessOptions = [{ value: 'b1', label: 'One business' }];
const branchOptions = [
  { value: 'br1', label: 'Salmiya' },
  { value: 'br2', label: 'Hawally' },
];

function switcher(
  overrides: Partial<Parameters<typeof WorkspaceSwitcher>[0]> & {
    onBranchChange: (value: string) => void;
  },
) {
  const props = {
    labels,
    businessName: 'One business',
    branchName: 'Salmiya',
    companyValue: 'c1',
    businessValue: 'b1',
    branchValue: 'br1',
    companyOptions,
    businessOptions,
    branchOptions,
    onCompanyChange: vi.fn(),
    onBusinessChange: vi.fn(),
    ...overrides,
  };
  return (
    <DirectionProvider dir="rtl">
      <WorkspaceSwitcher {...props} />
    </DirectionProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

it('shows the business and the branch on the trigger and opens the three fields', async () => {
  render(switcher({ onBranchChange: vi.fn() }));
  const trigger = screen.getByRole('button', { name: /One business/ });
  expect(trigger.textContent).toContain('Salmiya');
  fireEvent.click(trigger);
  expect(await screen.findByText('Company')).toBeTruthy();
  // الحوار المفتوح يحمل اسمًا متاحًا من المستدعي، فقارئ الشاشة يعرف ماذا فتح
  const dialog = screen.getByRole('dialog', { name: 'Workspaces' });
  // الحوار في portal خارج العنصر الحامل للاتجاه، فيحمل اتجاه المستدعي بنفسه
  expect(dialog.getAttribute('dir')).toBe('rtl');
  // ومقاسه مسقوف بالمساحة المتاحة مع تمرير داخلي، فلا يخرج حقل عن شاشة قصيرة
  expect(dialog.className).toContain('max-h-[var(--radix-popover-content-available-height)]');
  expect(dialog.className).toContain('overflow-y-auto');
  expect(screen.getByRole('combobox', { name: 'Company' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Business' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Branch' })).toBeTruthy();
});

it('opens and shows all three fields even for a single company, business and branch', async () => {
  render(
    switcher({
      onBranchChange: vi.fn(),
      companyValue: 'only',
      businessValue: 'only-b',
      branchValue: 'only-br',
      companyOptions: [{ value: 'only', label: 'Only company' }],
      businessOptions: [{ value: 'only-b', label: 'Only business' }],
      branchOptions: [{ value: 'only-br', label: 'Only branch' }],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: /One business/ }));
  expect(await screen.findByText('Only company')).toBeTruthy();
  expect(screen.getByText('Only business')).toBeTruthy();
  expect(screen.getByText('Only branch')).toBeTruthy();
});

it('keeps Business and Branch disabled while the caller reports no selection yet', async () => {
  render(
    switcher({
      onBranchChange: vi.fn(),
      businessDisabled: true,
      branchDisabled: true,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: /One business/ }));
  const business = (await screen.findByRole('combobox', { name: 'Business' })) as HTMLElement;
  const branch = screen.getByRole('combobox', { name: 'Branch' }) as HTMLElement;
  expect(
    business.getAttribute('aria-disabled') === 'true' || business.hasAttribute('disabled'),
  ).toBe(true);
  expect(branch.getAttribute('aria-disabled') === 'true' || branch.hasAttribute('disabled')).toBe(
    true,
  );
  expect(
    screen.getByRole('combobox', { name: 'Company' }).getAttribute('aria-disabled'),
  ).toBeNull();
});

// المبدّل محكوم من المستدعي: الاختيار يوصل له، وهو يغيّر الفرع فيظهر اسمه على الزر
function SwitcherWithCallerState({ onBranchChange }: { onBranchChange: (value: string) => void }) {
  const [branchValue, setBranchValue] = useState('br1');
  return switcher({
    branchValue,
    branchName: branchOptions.find((option) => option.value === branchValue)?.label ?? '',
    onBranchChange: (value) => {
      onBranchChange(value);
      setBranchValue(value);
    },
  });
}

it('reports the branch choice to the caller, whose new branch shows on the trigger', async () => {
  const onBranchChange = vi.fn();
  render(<SwitcherWithCallerState onBranchChange={onBranchChange} />);
  const trigger = screen.getByRole('button', { name: /One business/ });
  expect(trigger.textContent).toContain('Salmiya');
  fireEvent.click(trigger);
  const branchTrigger = await screen.findByRole('combobox', { name: 'Branch' });
  fireEvent.keyDown(branchTrigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: 'Hawally' });
  fireEvent.click(option);
  await waitFor(() => expect(trigger.textContent).toContain('Hawally'));
  expect(onBranchChange).toHaveBeenCalledWith('br2');
});

it('closes on Escape and returns the focus to the trigger button', async () => {
  const onOpenChange = vi.fn();
  render(switcher({ onBranchChange: vi.fn(), onOpenChange }));
  const trigger = screen.getByRole('button', { name: /One business/ });
  fireEvent.click(trigger);
  const companyLabel = await screen.findByText('Company');
  const popover = companyLabel.closest('[data-radix-popper-content-wrapper]') as HTMLElement;
  expect(popover).toBeTruthy();
  // مفتوحًا، التركيز انتقل داخل اللوحة النمطية — ليس على الزر
  expect(document.activeElement).not.toBe(trigger);
  expect(popover.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement ?? popover, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByText('Company')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});
