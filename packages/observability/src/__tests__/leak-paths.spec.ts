import { Writable } from 'node:stream';

import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger.ts';

// Every way a value can reach a pino line other than a plain logged key (Codex review of T6b, round 2).
// Each case checks the final written line, not an intermediate object.
const capture = (log: (logger: Logger) => void): string => {
  let written = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  log(createLogger('info', sink));
  return written;
};

const SECRET = 'tok_live_leak';

describe('the message field', () => {
  it('an Error logged on its own does not put its message into msg', () => {
    const line = capture((log) => log.error(new Error(`failed: token=${SECRET}`)));
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ msg: 'error', err: { type: 'Error' } });
  });

  it('an { err } logged without a message does not put the error message into msg', () => {
    const line = capture((log) => log.error({ err: new Error(`token=${SECRET}`) }));
    expect(line).not.toContain(SECRET);
  });

  it('printf-style arguments are dropped, never interpolated into msg', () => {
    const line = capture((log) => log.info('user signed in with %s', SECRET));
    expect(line).not.toContain(SECRET);
  });
});

describe('child logger bindings', () => {
  it('bindings on a child, a grandchild and setBindings are sanitised', () => {
    const line = capture((log) => {
      const child = log.child({ token: SECRET, phone: '96550012345' });
      child.child({ nested: { apiKey: SECRET } }).info('event');
      child.setBindings({ password: SECRET });
      child.info('after setBindings');
    });
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('96550012345');
    expect(line).toContain('***345');
  });
});

describe('error text posing as structure', () => {
  it('a multiline message cannot pose as a stack frame', () => {
    const line = capture((log) =>
      log.error({ err: new Error(`failure\n    at token=${SECRET}`) }, 'x'),
    );
    expect(line).not.toContain(SECRET);
  });

  it('a name or code outside the allowlist is dropped, not printed', () => {
    const error = Object.assign(new Error('x'), { code: `code ${SECRET}` });
    error.name = `Name${SECRET}`;
    const line = capture((log) => log.error({ err: error }, 'x'));
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ err: { type: 'Error' } });
  });
});

describe('executable data', () => {
  it('a toJSON hook is dropped, so JSON serialisation cannot call it', () => {
    const line = capture((log) =>
      log.info({ payload: { safe: 1, toJSON: () => ({ token: SECRET }) } }, 'probe'),
    );
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ payload: { safe: 1 } });
  });

  it('dates become ISO strings and bigints strings', () => {
    const line = capture((log) =>
      log.info({ at: new Date('2026-09-23T00:00:00Z'), mills: 12_500n }, 'probe'),
    );
    expect(JSON.parse(line)).toMatchObject({ at: '2026-09-23T00:00:00.000Z', mills: '12500' });
  });
});

describe('round 3 — values that satisfied the earlier rules', () => {
  it('a thrown string or plain object under err is reduced to a fixed label', () => {
    const line = capture((log) => {
      log.error({ err: `token=${SECRET}` }, 'x');
      log.error({ err: { message: `token=${SECRET}` } }, 'x');
    });
    expect(line).not.toContain(SECRET);
    expect(line).toContain('"type":"NonError"');
  });

  it('a PIN-shaped code or a crafted name is never printed', () => {
    const error = Object.assign(new Error('x'), { code: '482193' });
    error.name = 'LeakyTokError';
    const line = capture((log) => log.error({ err: error }, 'x'));
    expect(line).not.toContain('482193');
    expect(line).not.toContain('LeakyTok');
  });

  it('a stale cached stack cannot smuggle a fake frame', () => {
    const error = new Error(`failure\n    at token=${SECRET}`);
    void error.stack;
    error.message = 'failure';
    expect(capture((log) => log.error({ err: error }, 'x'))).not.toContain(SECRET);
  });

  it('a message carrying data is withheld — interpolated text, an error message, a digit run', () => {
    const error = new Error(`token=${SECRET}`);
    const line = capture((log) => {
      // eslint-disable-next-line no-restricted-syntax -- proves the runtime guard behind the lint rule
      log.info(`token=${SECRET}`);
      log.error(error, error.message);
      log.info('customer 96550012345 paid');
    });
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('96550012345');
    expect(line.match(/log message withheld/g)).toHaveLength(3);
  });

  it('a constant event name is kept', () => {
    expect(JSON.parse(capture((log) => log.info('redis connection error')))).toMatchObject({
      msg: 'redis connection error',
    });
  });
});

describe('binding ownership', () => {
  it('a grandchild inherits its parents; setBindings changes only its own logger', () => {
    const lines = capture((log) => {
      const child = log.child({ requestId: 'r1' });
      const sibling = log.child({ requestId: 'r2' });
      child.child({ step: 'inner' }).info('grandchild');
      child.setBindings({ requestId: 'r1-updated' });
      child.info('child');
      sibling.info('sibling');
      log.info('root');
    })
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ requestId: 'r1', step: 'inner', msg: 'grandchild' });
    expect(lines[1]).toMatchObject({ requestId: 'r1-updated', msg: 'child' });
    expect(lines[2]).toMatchObject({ requestId: 'r2', msg: 'sibling' });
    expect(lines[3]).not.toHaveProperty('requestId');
  });
});
