import { beforeEach, expect, it, vi } from 'vitest';
import { migrationClient } from '../migrations.ts';

const state = vi.hoisted(() => ({
  end: vi.fn(),
  onparameter: (): void => undefined,
  onclose: (): void => undefined,
}));
vi.mock('postgres', () => ({
  default: (_url: string, options: { onparameter(): void; onclose(): void }) => {
    state.onparameter = options.onparameter;
    state.onclose = options.onclose;
    return { end: state.end };
  },
}));
beforeEach(() => {
  state.end.mockReset().mockResolvedValue(undefined);
});

it('a resolved driver end cannot publish the template until the actual socket close is acknowledged', async () => {
  const connection = migrationClient('synthetic');
  state.onparameter();
  let returned = false;
  const closing = connection.close().then(() => {
    returned = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(state.end).toHaveBeenCalledOnce();
  expect(returned).toBe(false);
  state.onclose();
  await closing;
  expect(returned).toBe(true);
});

it('a connection that already closed on a migration error does not wait for a second close event', async () => {
  const connection = migrationClient('synthetic');
  state.onparameter();
  state.onclose();
  await expect(connection.close()).resolves.toBeUndefined();
});
