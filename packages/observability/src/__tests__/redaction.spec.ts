import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { loggerOptions } from '../logger.ts';

// Logs one object through the real pino config and returns the exact line pino wrote.
const logLine = (entry: Record<string, unknown>): string => {
  let written = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  pino(loggerOptions('info'), sink).info(entry, 'probe');
  return written;
};

describe('redaction (CLAUDE.md §8)', () => {
  it('never prints a PIN, password, token or secret — top level or nested', () => {
    const line = logLine({
      pin: '4821',
      password: 'hunter2hunter2',
      token: 'tok_live_abcdef',
      user: { pin: '9911', apiKey: 'key_live_123', refreshToken: 'rt_xyz' },
    });
    for (const secret of [
      '4821',
      'hunter2hunter2',
      'tok_live_abcdef',
      '9911',
      'key_live_123',
      'rt_xyz',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
  });

  it('keeps only the last 3 digits of a phone number', () => {
    const line = logLine({ phone: '+965 5001 2345', customer: { mobile: '96550067890' } });
    expect(line).not.toContain('50012345');
    expect(line).not.toContain('5006789');
    expect(JSON.parse(line)).toMatchObject({ phone: '***345', customer: { mobile: '***890' } });
  });

  it('redacts authorization and cookie headers on a request', () => {
    const line = logLine({
      req: { headers: { authorization: 'Bearer secret-token', cookie: 'session=abc123' } },
    });
    expect(line).not.toContain('secret-token');
    expect(line).not.toContain('abc123');
  });

  it('still prints ordinary fields', () => {
    expect(JSON.parse(logLine({ companyName: 'Salon One' }))).toMatchObject({
      companyName: 'Salon One',
      msg: 'probe',
    });
  });
});
