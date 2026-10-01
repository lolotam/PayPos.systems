import { describe, expect, it } from 'vitest';

import { call } from './call';

function testSuccessAndNetwork(): void {
  it('returns ok result when response is ok and data is present', async () => {
    const result = await call(async () => ({
      response: new Response(null, { status: 200 }),
      data: { device_id: 'test-device' },
    }));

    expect(result).toEqual({
      ok: true,
      data: { device_id: 'test-device' },
    });
  });

  it('returns network failure when the fetch invocation throws', async () => {
    const result = await call(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'network' },
    });
  });
}

function testValidEnvelope(): void {
  it('returns HTTP failure with envelope when error response contains a valid error envelope', async () => {
    const result = await call(async () => ({
      response: new Response(null, { status: 400 }),
      error: {
        code: 'PAIRING_CODE_INVALID',
        message_ar: 'كود غير صالح',
        message_en: 'Invalid pairing code',
      },
    }));

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 400,
        envelope: {
          code: 'PAIRING_CODE_INVALID',
          message_ar: 'كود غير صالح',
          message_en: 'Invalid pairing code',
        },
      },
    });
  });
}

function testMalformedEnvelope(): void {
  it('returns HTTP failure with envelope null when error body is malformed or missing fields', async () => {
    const stringBodyResult = await call(async () => ({
      response: new Response(null, { status: 502 }),
      error: 'Bad Gateway',
    }));
    expect(stringBodyResult).toEqual({
      ok: false,
      failure: { kind: 'http', status: 502, envelope: null },
    });

    const incompleteBodyResult = await call(async () => ({
      response: new Response(null, { status: 500 }),
      error: { code: 'SERVER_ERROR' },
    }));
    expect(incompleteBodyResult).toEqual({
      ok: false,
      failure: { kind: 'http', status: 500, envelope: null },
    });

    const wrongTypesResult = await call(async () => ({
      response: new Response(null, { status: 422 }),
      error: { code: 123, message_ar: null, message_en: true },
    }));
    expect(wrongTypesResult).toEqual({
      ok: false,
      failure: { kind: 'http', status: 422, envelope: null },
    });
  });
}

describe('call', () => {
  testSuccessAndNetwork();
  testValidEnvelope();
  testMalformedEnvelope();
});
