import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FrameChrome } from './frame-chrome';
import { frameState, renderFrame, resetFrameState } from './frame-test-support';

vi.mock('next/navigation', async () => (await import('./frame-test-support')).navigationMock);

beforeEach(() => {
  resetFrameState();
  frameState.pathname = '/staff';
});

describe('FrameChrome link boundary', () => {
  it.each([
    ['a pure fragment link', { href: '#pending' }],
    ['a link with target _self', { href: '/leave', target: '_self' }],
    ['a link with target _top', { href: '/leave', target: '_top' }],
  ])('leaves %s to the browser', (_name, props) => {
    renderFrame(
      <FrameChrome>
        <a {...props}>Open</a>
      </FrameChrome>,
    );
    expect(fireEvent.click(screen.getByRole('link', { name: 'Open' }))).toBe(true);
    expect(frameState.push).not.toHaveBeenCalled();
    expect(frameState.pathname).toBe('/staff');
  });

  it('still takes a plain same-tab link to the router', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">Open</a>
      </FrameChrome>,
    );
    expect(fireEvent.click(screen.getByRole('link', { name: 'Open' }))).toBe(false);
    expect(frameState.pathname).toBe('/leave');
  });
});
