import { expect, it } from 'vitest';
import { readConfig } from '../config.ts';

const valid = {
  DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic',
  DISPATCHER_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

it('keeps the measured sale transaction budget when it is not set', () => {
  expect(readConfig({ ...valid }).PACKAGE_SALE_TRANSACTION_TIMEOUT_MS).toBe(30_000);
  expect(
    readConfig({ ...valid, PACKAGE_SALE_TRANSACTION_TIMEOUT_MS: '' })
      .PACKAGE_SALE_TRANSACTION_TIMEOUT_MS,
  ).toBe(30_000);
});

it('reads the sale transaction budget the deployment supplies', () => {
  expect(
    readConfig({ ...valid, PACKAGE_SALE_TRANSACTION_TIMEOUT_MS: '45000' })
      .PACKAGE_SALE_TRANSACTION_TIMEOUT_MS,
  ).toBe(45_000);
});

it.each(['999', '120001'])('refuses the sale transaction budget %s', (value) => {
  expect(() =>
    readConfig({ ...valid, PACKAGE_SALE_TRANSACTION_TIMEOUT_MS: value }),
  ).toThrow('PACKAGE_SALE_TRANSACTION_TIMEOUT_MS');
});
