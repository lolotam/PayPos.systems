import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import { deriveEmployeeCardKey } from '@pospay/auth';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { API_LOG_EVENTS } from '../../../shared/log-events.ts';
import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import {
  CARD_SCAN_FAILURES_PER_WINDOW,
  createCardScanAttempts,
} from '../persistence/card-scan-attempts.ts';
import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';
import { CardScanAttemptsUnavailableError } from '../ports/card-scan-attempts.port.ts';

const hash = createEmployeeCardHash(
  deriveEmployeeCardKey('test-secret-that-is-long-enough-for-hmac'),
);

it('logs the redis error through the report callback and fails the scan closed', async () => {
  let line = '';
  const logger = createLogger('warn', {
    destination: new Writable({
      write(chunk, _encoding, done) {
        line += String(chunk);
        done();
      },
    }),
    events: API_LOG_EVENTS,
  });
  const cause = Object.assign(new Error('redis://:secret@host NO-SUCH-CARD'), {
    code: 'ECONNREFUSED',
  });
  const broken: RateLimiter = {
    hit: () => Promise.reject(cause),
    remember: () => Promise.reject(cause),
    remembered: () => Promise.reject(cause),
    count: () => Promise.reject(cause),
    remaining: () => Promise.reject(cause),
  };
  const reported: { companyId: string; deviceId: string }[] = [];
  await expect(
    createCardScanAttempts(broken, hash, (error, companyId, deviceId) => {
      reported.push({ companyId, deviceId });
      logger.warn(
        { err: error, company_id: companyId, device_id: deviceId },
        'card scan redis unavailable',
      );
    }).inspect('company', 'device', 'key', 'fingerprint'),
  ).rejects.toBeInstanceOf(CardScanAttemptsUnavailableError);
  expect(reported).toEqual([{ companyId: 'company', deviceId: 'device' }]);
  expect(line).toContain('card scan redis unavailable');
  expect(line).toContain('ECONNREFUSED');
  expect(line).not.toContain('NO-SUCH-CARD');
  expect(line).not.toContain('secret');
});

it('stores a keyed scan-attempt marker and not the raw fingerprint digest', async () => {
  const seen: string[] = [];
  const limiter: RateLimiter = {
    hit: () => Promise.resolve(true),
    count: () => Promise.resolve(0),
    remembered: (key) => Promise.resolve(seen.includes(key)),
    remember: (key) => {
      seen.push(key);
      return Promise.resolve();
    },
    remaining: () => Promise.resolve(500),
  };
  const attempts = createCardScanAttempts(limiter, hash, () => undefined);
  const fingerprint = createHash('sha256').update('{"card_code":"WmSecret!9zCd"}').digest('hex');
  const idempotencyKey = 'idem-key-1';
  const unkeyed = createHash('sha256')
    .update(idempotencyKey)
    .update('\0')
    .update(fingerprint)
    .digest('hex');
  const marker = hash('company', JSON.stringify([idempotencyKey, fingerprint]), 'scan-attempt');
  await expect(attempts.inspect('company', 'device', idempotencyKey, fingerprint)).resolves.toEqual(
    { outcome: 'open' },
  );
  await attempts.complete('company', 'device', idempotencyKey, fingerprint);
  expect(seen).toEqual([`card-scan:company:device:${marker}`]);
  expect(seen.join(' ')).not.toContain(fingerprint);
  expect(seen.join(' ')).not.toContain(unkeyed);
  await expect(attempts.inspect('company', 'device', idempotencyKey, fingerprint)).resolves.toEqual(
    { outcome: 'replay' },
  );
});

it('raises a vanished scan window to one second so Retry-After is never zero', async () => {
  const limiter: RateLimiter = {
    hit: () => Promise.resolve(false),
    count: () => Promise.resolve(CARD_SCAN_FAILURES_PER_WINDOW),
    remembered: () => Promise.resolve(false),
    remember: () => Promise.resolve(),
    remaining: () => Promise.resolve(0),
  };
  await expect(
    createCardScanAttempts(limiter, hash, () => undefined).inspect(
      'company',
      'device',
      'key',
      'fingerprint',
    ),
  ).resolves.toEqual({ outcome: 'limited', remaining: 1 });
});
