import { Writable } from 'node:stream';

import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createBusinessInput, errorEnvelope } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { ZodValidationPipe } from '../zod-validation.pipe.ts';

// Test-only routes: a contract-validated body, a deliberate crash, and a route that logs secrets.
@Controller('probe')
class ProbeController {
  @Post('business')
  create(@Body(new ZodValidationPipe(createBusinessInput)) body: unknown): unknown {
    return body;
  }

  @Get('crash')
  crash(): never {
    throw new Error('SELECT * FROM companies — internal detail that must not leak');
  }

  @Get('log-secrets')
  logSecrets(@Req() request: FastifyRequest): { logged: true } {
    request.log.info({ pin: '4821', token: 'tok_live_secret', phone: '96550012345' }, 'probe');
    return { logged: true };
  }
}

let app: NestFastifyApplication;
let logs = '';

const request = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

beforeAll(async () => {
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs += String(chunk);
      done();
    },
  });
  app = await createApp(
    { readiness: [] },
    { controllers: [ProbeController], logDestination: sink },
  );
});

afterAll(async () => {
  await app.close();
});

describe('every error is the bilingual envelope', () => {
  it('an invalid body is 400 VALIDATION_FAILED with paths and codes, never the rejected values', async () => {
    const res = await request('POST', '/v1/probe/business', {
      vertical_type: 'bakery',
      name_en: '',
      company_id: 'someone-elses',
    });
    expect(res.status).toBe(400);
    const envelope = errorEnvelope.parse(res.body);
    expect(envelope.code).toBe('VALIDATION_FAILED');
    expect(envelope.message_ar.length).toBeGreaterThan(0);
    expect(JSON.stringify(envelope.details)).not.toContain('bakery');
    expect(JSON.stringify(envelope.details)).not.toContain('someone-elses');
  });

  it('a valid body passes through the contract with its defaults applied', async () => {
    const res = await request('POST', '/v1/probe/business', {
      vertical_type: 'salon',
      name_en: 'Main',
    });
    expect(res).toEqual({
      status: 201,
      body: {
        vertical_type: 'salon',
        name_en: 'Main',
        currency: 'KWD',
        timezone: 'Asia/Kuwait',
        settings: {},
      },
    });
  });

  it('an unexpected error is 500 INTERNAL_ERROR and its message never reaches the client', async () => {
    const res = await request('GET', '/v1/probe/crash');
    expect(res.status).toBe(500);
    expect(errorEnvelope.parse(res.body).code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
    expect(logs).toContain('unhandled error');
  });

  it('an unknown route is 404 NOT_FOUND in the envelope', async () => {
    const res = await request('GET', '/v1/nothing-here');
    expect(res.status).toBe(404);
    expect(errorEnvelope.parse(res.body).code).toBe('NOT_FOUND');
  });

  it('routes other than /health and /ready live under /v1', async () => {
    expect((await request('POST', '/probe/business', {})).status).toBe(404);
  });
});

describe('request logs go through the redaction list', () => {
  it('a PIN, a token and a full phone number logged by a handler never reach the output', async () => {
    await request('GET', '/v1/probe/log-secrets');
    expect(logs).toContain('"msg":"probe"');
    for (const secret of ['4821', 'tok_live_secret', '96550012345']) {
      expect(logs).not.toContain(secret);
    }
    expect(logs).toContain('***345');
  });
});
