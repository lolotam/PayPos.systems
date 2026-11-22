import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { PageFinder } from '../page-finder.js';
import { finderLabels, workspaces } from './navigation-fixtures.js';

const tree = (resetKey: string | undefined) => (
  <DirectionProvider dir="ltr">
    <PageFinder workspaces={workspaces} labels={finderLabels} resetKey={resetKey} />
  </DirectionProvider>
);

it('closes an open finder and clears its search when the host changes the reset key', () => {
  const { rerender } = render(tree('/one'));
  const trigger = screen.getByRole('button', { name: finderLabels.trigger });
  fireEvent.click(trigger);
  fireEvent.change(screen.getByRole('searchbox', { name: finderLabels.search }), {
    target: { value: 'pro' },
  });
  rerender(tree('/two'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: finderLabels.trigger })).toBe(trigger);
  fireEvent.click(trigger);
  expect(
    (screen.getByRole('searchbox', { name: finderLabels.search }) as HTMLInputElement).value,
  ).toBe('');
});

it('stays open while the reset key does not change', () => {
  const { rerender } = render(tree('/one'));
  fireEvent.click(screen.getByRole('button', { name: finderLabels.trigger }));
  rerender(tree('/one'));
  expect(screen.getByRole('dialog', { name: finderLabels.title })).toBeTruthy();
});
