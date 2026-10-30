import { Controller, Get, Inject, Req } from '@nestjs/common';
import { RATING_TOKEN_HEADER, type RatingView } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../shared/errors.ts';
import { Public } from '../../../shared/public.decorator.ts';
import {
  RatingSubmissionBusyError,
  ViewRatingUseCase,
} from '../use-cases/view-rating/view-rating.usecase.ts';

@Controller()
export class RatingViewController {
  readonly #view: ViewRatingUseCase | null;

  constructor(@Inject(ViewRatingUseCase) view: ViewRatingUseCase | null) {
    this.#view = view;
  }

  @Get('ratings/view')
  @Public()
  async view(@Req() request: FastifyRequest): Promise<RatingView> {
    const useCase = this.#view;
    if (useCase === null) throw new ApiError('NOT_READY');
    // الهيدر بيتقرا هنا مش في pipe: التوكن مش لازم يكون شكله صح عشان يتحسب في الحد (D-B10).
    const header = request.headers[RATING_TOKEN_HEADER];
    const token = typeof header === 'string' ? header : '';
    try {
      const outcome = await useCase.execute({ token });
      if (outcome === 'UNAVAILABLE') throw new ApiError('RATING_LINK_UNAVAILABLE');
      return outcome;
    } catch (error) {
      // القفل ما اتاخدش في الوقت: الخدمة مش جاهزة دلوقتي، مش رفض للتوكن.
      if (error instanceof RatingSubmissionBusyError) throw new ApiError('NOT_READY');
      throw error;
    }
  }
}
