import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../../shared/errors.ts';
import {
  RatingSubmissionBusyError,
  type ViewRatingOutcome,
  type ViewRatingUseCase,
} from '../../use-cases/view-rating/view-rating.usecase.ts';
import { RatingViewController } from '../rating-view.controller.ts';

interface Built {
  readonly controller: RatingViewController;
  readonly tokens: string[];
}

function build(result: { outcome?: ViewRatingOutcome; error?: unknown } | null): Built {
  const tokens: string[] = [];
  const useCase = {
    execute: async (input: { readonly token: string }): Promise<ViewRatingOutcome> => {
      tokens.push(input.token);
      if (result?.error !== undefined) throw result.error;
      return result?.outcome ?? { business_name: 'Palm Salon', state: 'open' };
    },
  } as unknown as ViewRatingUseCase;
  return { controller: new RatingViewController(useCase), tokens };
}

function requestWith(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('the rating view endpoint', () => {
  it('answers with the business name and the link state', async () => {
    const { controller, tokens } = build({
      outcome: { business_name: 'صالون النخيل', state: 'submitted' },
    });
    await expect(
      controller.view(requestWith({ 'x-rating-token': 'a-token' })),
    ).resolves.toEqual({ business_name: 'صالون النخيل', state: 'submitted' });
    expect(tokens).toEqual(['a-token']);
  });

  it('answers 404 when the link is not available', async () => {
    const { controller } = build({ outcome: 'UNAVAILABLE' });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.view(request).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'RATING_LINK_UNAVAILABLE', status: 404 });
  });

  it('reads the token from the header, never from the body', async () => {
    const { controller, tokens } = build({});
    await controller.view(requestWith({ 'x-rating-token': 'a-token' }));
    expect(tokens).toEqual(['a-token']);
  });

  it('refuses a missing header as an unusable token', async () => {
    const { controller, tokens } = build({});
    await controller.view(requestWith({}));
    expect(tokens).toEqual(['']);
  });

  it('refuses a repeated header as an unusable token', async () => {
    const { controller, tokens } = build({});
    await controller.view(requestWith({ 'x-rating-token': ['one', 'two'] }));
    expect(tokens).toEqual(['']);
  });

  it('answers 503 when the database is not wired', async () => {
    const controller = new RatingViewController(null);
    const error = await controller.view(requestWith({})).catch((e) => e);
    expect(error).toMatchObject({ code: 'NOT_READY', status: 503 });
  });

  it('answers 503 when the lock could not be taken in time', async () => {
    const { controller } = build({ error: new RatingSubmissionBusyError() });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.view(request).catch((e) => e);
    expect(error).toMatchObject({ code: 'NOT_READY', status: 503 });
  });

  it('lets any other failure through unchanged', async () => {
    const { controller } = build({ error: new Error('boom') });
    const request = requestWith({ 'x-rating-token': 'a-token' });
    const error = await controller.view(request).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
  });
});
