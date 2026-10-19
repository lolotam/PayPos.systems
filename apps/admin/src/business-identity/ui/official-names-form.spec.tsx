import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OfficialNamesForm } from './official-names-form';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const stale = { official_name_ar: 'Old', official_name_en: 'Old Shop' };
const fresh = { official_name_ar: 'New', official_name_en: 'New Shop' };

function valueOf(label: RegExp): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

function form(saved: typeof stale | null, baseline = fresh) {
  return <OfficialNamesForm baseline={baseline} saved={saved} pending={false} onSave={vi.fn()} />;
}

it('mounts on the fresh baseline, not on a save that finished before the form unmounted', () => {
  render(form(stale));
  expect(valueOf(/arabic/i)).toBe('New');
  expect(valueOf(/english/i)).toBe('New Shop');
});

it('still resets to a save that completes while the form is mounted', () => {
  const view = render(form(null));
  const saved = { official_name_ar: 'Saved', official_name_en: 'Saved Shop' };
  view.rerender(form(saved));
  expect(valueOf(/arabic/i)).toBe('Saved');
  expect(valueOf(/english/i)).toBe('Saved Shop');
});
