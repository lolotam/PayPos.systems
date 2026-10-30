import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../../shared/errors.ts';
import {
  RatingSubmissionBusyError,
  type SubmitRatingOutcome,
  type SubmitRatingUseCase,
} from '../../use-cases/submit-rating/submit-rating.usecase.ts';
import { RatingSubmitController } from '../rating-submit.controller.ts';

interface Built {
  readonly controller: RatingSubmitController;
  readonly tokens: string[];
  readonly bodies: unknown[];
}

function build(result: { outcome?: SubmitRatingOutcome; error?: unknown } | null): Built {
  const tokens: string[] = [];
  const bodies: unknown[] = [];
  const useCase = {
    execute: async (input: {
      readonly token: string;
      readonly body: unknown;
    }): Promise<SubmitRatingOutcome> => {
      tokens.push(input.token);
      bodies.push(input.body);
      if (result?.error !== undefined) throw result.error;
      return result?.outcome ?? 'SUBMITTED';
    },
  } as unknown as SubmitRatingUseCase;
  return { controller: new RatingSubmitController(useCase), tokens, bodies };
}

function requestWith(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('the rating submit endpoint', () => {
  it('answers with no body when the rating was stored', async () => {
    const { controller, tokens, bodies } = build({ outcome: 'SUBMITTED' });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    await expect(controller.submit(request, { stars: 5 })).resolves.toBeUndefined();
    expect(tokens).toEqual(['a-token']);
    expect(bodies).toEqual([{ stars: 5 }]);
  });

  it('answers 400 when the body is not valid', async () => {
    const { controller } = build({ outcome: 'INVALID' });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.submit(request, { stars: 9 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'RATING_INPUT_INVALID', status: 400 });
  });

  it('answers 404 when the link is not available', async () => {
    const { controller } = build({ outcome: 'UNAVAILABLE' });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.submit(request, { stars: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'RATING_LINK_UNAVAILABLE', status: 404 });
  });

  it('reads the token from the header and hands the body over untouched', async () => {
    const { controller, tokens, bodies } = build({});
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const body = { stars: 4, comment: 'كويس' };
    await controller.submit(request, body);
    expect(tokens).toEqual(['a-token']);
    expect(bodies).toEqual([body]);
  });

  it('refuses a missing header as an unusable token', async () => {
    const { controller, tokens } = build({});
    await controller.submit(requestWith({}), { stars: 5 });
    expect(tokens).toEqual(['']);
  });

  it('refuses a repeated header as an unusable token', async () => {
    const { controller, tokens } = build({});
    await controller.submit(requestWith({ 'x-rating-token': ['one', 'two'] }), { stars: 5 });
    expect(tokens).toEqual(['']);
  });

  it('answers 503 when the database is not wired', async () => {
    const controller = new RatingSubmitController(null);
    const error = await controller.submit(requestWith({}), { stars: 5 }).catch((e) => e);
    expect(error).toMatchObject({ code: 'NOT_READY', status: 503 });
  });

  it('answers 503 when the lock could not be taken in time', async () => {
    const { controller } = build({ error: new RatingSubmissionBusyError() });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.submit(request, { stars: 5 }).catch((e) => e);
    expect(error).toMatchObject({ code: 'NOT_READY', status: 503 });
  });

  it('lets any other failure through unchanged', async () => {
    const { controller } = build({ error: new Error('boom') });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.submit(request, { stars: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
  });
});
