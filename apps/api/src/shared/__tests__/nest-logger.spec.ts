import { Writable } from 'node:stream';

import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { PinoNestLogger } from '../nest-logger.ts';
import { API_LOG_EVENTS } from '../log-events.ts';

describe('PinoNestLogger', () => {
  it('never prints the text or stack of a Nest error or warning', () => {
    let written = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    const logger = new PinoNestLogger(
      createLogger('debug', { destination: sink, events: API_LOG_EVENTS }),
    );
    logger.error(
      'connect postgres://app:leaked-password@db failed',
      'at stack-frame',
      'InstanceLoader',
    );
    logger.error(new Error('token=tok_nest_secret'), 'ExceptionHandler');
    logger.warn('using key key_live_nest', 'Bootstrap');
    logger.error('connection failed', 'TokSecretContext');
    for (const secret of [
      'leaked-password',
      'tok_nest_secret',
      'key_live_nest',
      'TokSecretContext',
    ]) {
      expect(written).not.toContain(secret);
    }
    expect(written).toContain('"nest":"InstanceLoader"');
  });

  it('the two-argument error(message, stack) overload never prints the stack as context', () => {
    let written = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    new PinoNestLogger(createLogger('debug', { destination: sink, events: API_LOG_EVENTS })).error(
      'connection failed',
      'Error: token=tok_stack_secret\n    at connect (/app/x.js:1:1)',
    );
    expect(written).not.toContain('tok_stack_secret');
  });
});
