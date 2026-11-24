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

describe('FrameChrome link prefetch on intent', () => {
  it('prefetches a link destination on pointer intent, once for the same destination', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.pointerOver(link);
    fireEvent.pointerOver(link);
    expect(frameState.prefetch).toHaveBeenCalledTimes(1);
    expect(frameState.prefetch).toHaveBeenCalledWith('/leave');
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });

  it('prefetches a link destination on keyboard focus', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.focus(link);
    expect(frameState.prefetch).toHaveBeenCalledTimes(1);
    expect(frameState.prefetch).toHaveBeenCalledWith('/leave');
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });

  it('prefetches a link destination on touch start', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.touchStart(link);
    expect(frameState.prefetch).toHaveBeenCalledTimes(1);
    expect(frameState.prefetch).toHaveBeenCalledWith('/leave');
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });
});

describe('FrameChrome link prefetch exclusions', () => {
  it.each([
    ['a link with target _blank', { href: '/leave', target: '_blank' }],
    ['a link with download', { href: '/leave', download: '' }],
    ['a fragment link', { href: '#pending' }],
    ['a link to another origin', { href: 'https://other.example/leave' }],
    ['a link to the current page', { href: '/staff' }],
  ])('does not prefetch %s', (_name, props) => {
    renderFrame(
      <FrameChrome>
        <a {...props}>Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.pointerOver(link);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(frameState.prefetch).not.toHaveBeenCalled();
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });

  it('does not prefetch the current page even with a query and a fragment', () => {
    renderFrame(
      <FrameChrome>
        <a href="/staff?x=1#y">Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.pointerOver(link);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(frameState.prefetch).not.toHaveBeenCalled();
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });
});

describe('FrameChrome link prefetch destinations', () => {
  it('prefetches when the pointer is over the text inside the link', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">
          <span>Open</span>
        </a>
      </FrameChrome>,
    );
    const text = screen.getByText('Open');
    fireEvent.pointerOver(text);
    expect(frameState.prefetch).toHaveBeenCalledTimes(1);
    expect(frameState.prefetch).toHaveBeenCalledWith('/leave');
    expect(text.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });

  it('prefetches again when the pointer comes back to a destination it left', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">Leave</a>
        <a href="/staff/create">Create</a>
      </FrameChrome>,
    );
    const leave = screen.getByRole('link', { name: 'Leave' });
    const create = screen.getByRole('link', { name: 'Create' });
    fireEvent.pointerOver(leave);
    fireEvent.pointerOver(create);
    fireEvent.pointerOver(leave);
    expect(frameState.prefetch.mock.calls).toEqual([['/leave'], ['/staff/create'], ['/leave']]);
    expect(leave.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });

  it('prefetches the path with its query and without its fragment', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave?tab=open#pending">Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.pointerOver(link);
    expect(frameState.prefetch).toHaveBeenCalledTimes(1);
    expect(frameState.prefetch).toHaveBeenCalledWith('/leave?tab=open');
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/staff');
  });
});

describe('FrameChrome link prefetch and click', () => {
  it('still takes a plain click to the router after a pointer over', () => {
    renderFrame(
      <FrameChrome>
        <a href="/leave">Open</a>
      </FrameChrome>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    fireEvent.pointerOver(link);
    expect(fireEvent.click(link)).toBe(false);
    expect(link.isConnected).toBe(true);
    expect(frameState.pathname).toBe('/leave');
  });
});
