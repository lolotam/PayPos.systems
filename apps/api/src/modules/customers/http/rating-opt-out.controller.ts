import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../shared/errors.ts';
import { Public } from '../../../shared/public.decorator.ts';
import {
  OptOutOfRatingsUseCase,
  RatingOptOutBusyError,
} from '../use-cases/opt-out-of-ratings/opt-out-of-ratings.usecase.ts';

@Controller()
export class RatingOptOutController {
  readonly #optOut: OptOutOfRatingsUseCase | null;

  constructor(@Inject(OptOutOfRatingsUseCase) optOut: OptOutOfRatingsUseCase | null) {
    this.#optOut = optOut;
  }

  @Post('ratings/opt-out')
  @Public()
  @HttpCode(204)
  async optOut(@Req() request: FastifyRequest): Promise<void> {
    const useCase = this.#optOut;
    if (useCase === null) throw new ApiError('NOT_READY');
    // الهيدر بيتقرا هنا مش في pipe: التوكن مش لازم يكون شكله صح عشان يتحسب في الحد (D-B10).
    const header = request.headers[RATING_TOKEN_HEADER];
    const token = typeof header === 'string' ? header : '';
    try {
      const outcome = await useCase.execute({ token });
      if (outcome === 'UNAVAILABLE') throw new ApiError('RATING_LINK_UNAVAILABLE');
    } catch (error) {
      // القفل ما اتاخدش في الوقت: الخدمة مش جاهزة دلوقتي، مش رفض للتوكن.
      if (error instanceof RatingOptOutBusyError) throw new ApiError('NOT_READY');
      throw error;
    }
  }
}
