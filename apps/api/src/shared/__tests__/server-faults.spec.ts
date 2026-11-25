import type { ArgumentsHost } from '@nestjs/common';
import { type MockInstance, expect, it, vi } from 'vitest';
import { EnvelopeExceptionFilter } from '../exception.filter.ts';
import {
  captureServerFaults,
  recordSwallowedFault,
  serverFaults,
} from '../../../test/server-faults.ts';

/** رمز شبيه بالسر يجب ألّا يظهر في أي سجل ولا في أي سطر مطبوع. */
const TOKEN = 'LEAKED_TOKEN_9F3A2B';
/** سطر مكدس خام يجب ألّا ينتقل إلى السجل. */
const FRAME = 'at leakedFrame (/srv/secret/handler.ts:12:3)';
/** رسالة متعددة السطور فيها الرمز وسطر مكدس مدسوس جواها. */
const MESSAGE = `boom ${TOKEN}\n    ${FRAME}`;

/** خطأ برسالة متعددة السطور ومكدس خام فيه الرمز وسطر المكدس. */
const leakyError = (): Error => {
  const error = new Error(MESSAGE);
  error.stack = `Error: ${MESSAGE}\n    at secondFrame (/srv/secret/other.ts:3:1)`;
  return error;
};

interface ReplyStub {
  statusCode: number;
  hasHeader: (name: string) => boolean;
  header: (name: string, value: string) => ReplyStub;
  status: (code: number) => ReplyStub;
  send: (body: unknown) => ReplyStub;
}

/** بديل رد Fastify يكفي لمرشح الاستثناءات: حالة 500 وتسجيل لا يطبع شيئًا. */
const replyStub = (): ReplyStub => {
  const reply: ReplyStub = {
    statusCode: 500,
    hasHeader: () => false,
    header: () => reply,
    status: () => reply,
    send: () => reply,
  };
  return reply;
};

/** بديل ArgumentsHost يمرّر خطأً إلى المرشح كما لو جاء من مسار HTTP. */
const hostStub = (): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getResponse: () => replyStub(),
      getRequest: () => ({ log: { error: () => undefined } }),
    }),
  }) as unknown as ArgumentsHost;

/** نص السجل الجديد بعد الفهرس المعطى: أخطاء الخادم المسجّلة والمطبوعة. */
const recorded = (from: number, spy: MockInstance): string => {
  const faults = JSON.stringify(serverFaults().slice(from));
  const logs = spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n');
  return `${faults}\n${logs}`;
};

it('records no message text of a swallowed fault', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const from = serverFaults().length;
    recordSwallowedFault(leakyError(), 500);
    const blob = recorded(from, spy);
    expect(blob).not.toContain(TOKEN);
    expect(blob).not.toContain('boom');
    expect(blob).not.toContain(FRAME);
  } finally {
    spy.mockRestore();
  }
});

it('records no symbolic message of a swallowed fault', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const from = serverFaults().length;
    recordSwallowedFault(new Error(TOKEN), 500);
    expect(recorded(from, spy)).not.toContain(TOKEN);
  } finally {
    spy.mockRestore();
  }
});

it('records no message and no stack frame of a captured 5xx', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const from = serverFaults().length;
    captureServerFaults();
    new EnvelopeExceptionFilter().catch(leakyError(), hostStub());
    const blob = recorded(from, spy);
    expect(blob).not.toContain(TOKEN);
    expect(blob).not.toContain('boom');
    expect(blob).not.toContain(FRAME);
  } finally {
    spy.mockRestore();
  }
});

it('records the class, the code, the SQLSTATE and the constraint of the cause chain', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const from = serverFaults().length;
    const cause = Object.assign(new Error('db failed'), {
      code: 'UNIQUE_VIOLATION',
      sqlstate: '23505',
      constraint_name: 'user_phone_number_key',
    });
    const outer = Object.assign(new Error('outer failed'), { cause });
    recordSwallowedFault(outer, 500);
    expect(serverFaults().slice(from)).toEqual([
      {
        status: 500,
        chain: [
          { name: 'Error', code: null, sqlstate: null, constraint: null },
          {
            name: 'Error',
            code: 'UNIQUE_VIOLATION',
            sqlstate: '23505',
            constraint: 'user_phone_number_key',
          },
        ],
      },
    ]);
  } finally {
    spy.mockRestore();
  }
});

it('stays silent for an error injected on purpose', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    captureServerFaults();
    new EnvelopeExceptionFilter().catch(new Error('INJECTED_CRASH'), hostStub());
    const printed = spy.mock.calls.filter((call) => String(call[0]).startsWith('SERVER_FAULT'));
    expect(printed).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});
