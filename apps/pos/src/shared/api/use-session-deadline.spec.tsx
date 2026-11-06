import { useCallback, useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSessionDeadline } from './use-session-deadline';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([
  '2099-10-04',
  '2099-10-04T12:00:00',
  '2099-10-04T12:00Z',
  '2099-02-31T00:00:00Z',
  '2027-02-29T12:00:00Z',
  '2099-13-01T00:00:00Z',
  '',
])('hides private content and clears the session for malformed expiry %s', (expiresAt) => {
  render(<DeadlineView expiresAt={expiresAt} />);
  expect(screen.queryByText('Private session content')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Session cleared');
});

it.each([
  '2099-10-04T12:00:00Z',
  '2099-10-04T12:00:00.123Z',
  '2099-10-04T12:00:00+03:00',
  '2099-10-04T12:00:00-03:00',
  '2028-02-29T12:00:00Z',
])('keeps private content for a valid future contract timestamp %s', (expiresAt) => {
  render(<DeadlineView expiresAt={expiresAt} />);
  expect(screen.getByText('Private session content')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it.each(['2026-10-04T09:59:59Z', '2026-10-04T10:00:00Z'])(
  'keeps the exact and elapsed deadline boundary closed for %s',
  (expiresAt) => {
    render(<DeadlineView expiresAt={expiresAt} />);
    expect(screen.queryByText('Private session content')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Session cleared');
  },
);

function DeadlineView({ expiresAt }: { expiresAt: string }) {
  const [cleared, setCleared] = useState(false);
  const clear = useCallback(() => setCleared(true), []);
  const live = useSessionDeadline(expiresAt, clear);
  return (
    <>
      {live ? <p>Private session content</p> : null}
      {cleared ? <p role="status">Session cleared</p> : null}
    </>
  );
}
