import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { loggerOptions } from '../logger.ts';

// Logs through the real pino config and returns exactly what pino wrote.
const capture = (log: (logger: pino.Logger) => void): string => {
  let written = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  log(pino(loggerOptions('info'), sink));
  return written;
};

const logLine = (entry: Record<string, unknown>): string =>
  capture((logger) => logger.info(entry, 'probe'));

const SECRETS = ['4821', 'hunter2hunter2', 'tok_live_abcdef', 'key_live_123', 'rt_xyz'];

describe('secrets are removed at any depth (CLAUDE.md §8)', () => {
  it('top level, nested three levels deep, and inside arrays', () => {
    const line = logLine({
      pin: '4821',
      data: { user: { profile: { password: 'hunter2hunter2', token: 'tok_live_abcdef' } } },
      batch: [{ apiKey: 'key_live_123' }, { nested: [{ refreshToken: 'rt_xyz' }] }],
    });
    for (const secret of SECRETS) expect(line).not.toContain(secret);
    expect(line).toContain('[REDACTED]');
  });

  it('whatever the key casing', () => {
    const line = logLine({
      Authorization: 'Bearer abc.def',
      TOKEN: 'tok_live_abcdef',
      Cookie: 'sid=1',
    });
    for (const secret of ['abc.def', 'tok_live_abcdef', 'sid=1'])
      expect(line).not.toContain(secret);
  });

  it('keeps only the last 3 digits of a phone number, even deep inside an array', () => {
    const line = logLine({
      phone: '+965 5001 2345',
      rows: [{ customer: { mobile: '96550067890' } }],
    });
    expect(line).not.toContain('50012345');
    expect(line).not.toContain('5006789');
    expect(JSON.parse(line)).toMatchObject({
      phone: '***345',
      rows: [{ customer: { mobile: '***890' } }],
    });
  });

  it('survives a circular object instead of hanging or throwing', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;
    expect(JSON.parse(logLine({ loop }))).toMatchObject({
      loop: { name: 'loop', self: '[Circular]' },
    });
  });

  it('still prints ordinary fields', () => {
    expect(JSON.parse(logLine({ companyName: 'Salon One' }))).toMatchObject({
      companyName: 'Salon One',
      msg: 'probe',
    });
  });
});

describe('errors are logged as type, code and frames — never the message or causes', () => {
  it('a secret in an error message, its cause, or an extra property never reaches the output', () => {
    const cause = new Error('upstream said token=tok_live_abcdef');
    const error = Object.assign(
      new Error('login failed for 96550012345 with pin 4821', { cause }),
      {
        code: '28P01',
        query: 'SELECT * FROM users WHERE password = hunter2hunter2',
      },
    );
    const line = capture((logger) => logger.error({ err: error }, 'boom'));
    for (const secret of ['tok_live_abcdef', '96550012345', '4821', 'hunter2hunter2', 'SELECT']) {
      expect(line).not.toContain(secret);
    }
    // '28P01' is outside the code allowlist (only E… and FST_ERR_… shapes are printed), so it is dropped too.
    expect(JSON.parse(line)).toMatchObject({ err: { type: 'Error' } });
    expect(JSON.parse(line).err).not.toHaveProperty('code');
  });
});

describe('requests are logged as method and route pattern — never the raw URL', () => {
  it('a token or phone in the path or query string never reaches the output', () => {
    const request = {
      method: 'GET',
      id: 'req-1',
      url: '/v1/reset/tok_live_abcdef?phone=96550012345',
      routeOptions: { url: '/v1/reset/:token' },
      headers: { authorization: 'Bearer abc.def' },
    };
    const line = capture((logger) => logger.info({ req: request }, 'incoming request'));
    for (const secret of ['tok_live_abcdef', '96550012345', 'abc.def']) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line)).toMatchObject({ req: { method: 'GET', route: '/v1/reset/:token' } });
  });
});
