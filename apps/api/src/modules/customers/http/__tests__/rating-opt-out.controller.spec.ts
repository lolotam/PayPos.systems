import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../../shared/errors.ts';
import {
  OptOutOfRatingsUseCase,
  RatingOptOutBusyError,
  type OptOutOfRatingsOutcome,
} from '../../use-cases/opt-out-of-ratings/opt-out-of-ratings.usecase.ts';
import { RatingOptOutController } from '../rating-opt-out.controller.ts';

interface Built {
  readonly controller: RatingOptOutController;
  readonly tokens: string[];
}

function build(result: { outcome?: OptOutOfRatingsOutcome; error?: unknown } | null): Built {
  const tokens: string[] = [];
  const useCase = {
    execute: async (input: { readonly token: string }): Promise<OptOutOfRatingsOutcome> => {
      tokens.push(input.token);
      if (result?.error !== undefined) throw result.error;
      return result?.outcome ?? 'ACCEPTED';
    },
  } as unknown as OptOutOfRatingsUseCase;
  return { controller: new RatingOptOutController(useCase), tokens };
}

function requestWith(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('the rating opt-out endpoint', () => {
  it('answers with no body when the customer opted out', async () => {
    const { controller, tokens } = build({ outcome: 'ACCEPTED' });
    await expect(
      controller.optOut(requestWith({ 'x-rating-token': 'a-token' })),
    ).resolves.toBeUndefined();
    expect(tokens).toEqual(['a-token']);
  });

  it('answers 404 when the link is not available', async () => {
    const { controller } = build({ outcome: 'UNAVAILABLE' });
    const error = await controller.optOut(requestWith({ 'x-rating-token': 'a-token' })).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'RATING_LINK_UNAVAILABLE', status: 404 });
  });

  it('reads the token from the header, never from the body', async () => {
    const { controller, tokens } = build({});
    await controller.optOut(requestWith({ 'x-rating-token': 'a-token' }));
    expect(tokens).toEqual(['a-token']);
  });

  it('refuses a missing header as an unusable token', async () => {
    const { controller, tokens } = build({});
    await controller.optOut(requestWith({}));
    expect(tokens).toEqual(['']);
  });

  it('refuses a repeated header as an unusable token', async () => {
    const { controller, tokens } = build({});
    await controller.optOut(requestWith({ 'x-rating-token': ['one', 'two'] }));
    expect(tokens).toEqual(['']);
  });

  it('answers 503 when the database is not wired', async () => {
    const controller = new RatingOptOutController(null);
    const error = await controller.optOut(requestWith({})).catch((e) => e);
    expect(error).toMatchObject({ code: 'NOT_READY', status: 503 });
  });

  it('answers 503 when the lock could not be taken in time', async () => {
    const { controller } = build({ error: new RatingOptOutBusyError() });
    const error = await controller.optOut(requestWith({ 'x-rating-token': 'a-token' })).catch((e) => e);
    expect(error).toMatchObject({ code: 'NOT_READY', status: 503 });
  });

  it('lets any other failure through unchanged', async () => {
    const { controller } = build({ error: new Error('boom') });
    const error = await controller.optOut(requestWith({ 'x-rating-token': 'a-token' })).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
  });
});
