import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../shared/errors.ts';
import { Public } from '../../../shared/public.decorator.ts';
import {
  RatingSubmissionBusyError,
  SubmitRatingUseCase,
} from '../use-cases/submit-rating/submit-rating.usecase.ts';

@Controller()
export class RatingSubmitController {
  readonly #submit: SubmitRatingUseCase | null;

  constructor(@Inject(SubmitRatingUseCase) submit: SubmitRatingUseCase | null) {
    this.#submit = submit;
  }

  @Post('ratings/submit')
  @Public()
  @HttpCode(204)
  async submit(@Req() request: FastifyRequest, @Body() body: unknown): Promise<void> {
    const useCase = this.#submit;
    if (useCase === null) throw new ApiError('NOT_READY');
    // الهيدر بيتقرا هنا مش في pipe: التوكن مش لازم يكون شكله صح عشان يتحسب في الحد (D-B10).
    const header = request.headers[RATING_TOKEN_HEADER];
    const token = typeof header === 'string' ? header : '';
    try {
      // الجسم بيتحقق منه في الـ use case: التحقق هناك بيضمن إن الرابط ما يستهلكش بجسم غلط.
      const outcome = await useCase.execute({ token, body });
      if (outcome === 'INVALID') throw new ApiError('RATING_INPUT_INVALID');
      if (outcome === 'UNAVAILABLE') throw new ApiError('RATING_LINK_UNAVAILABLE');
    } catch (error) {
      // القفل ما اتاخدش في الوقت: الخدمة مش جاهزة دلوقتي، مش رفض للتوكن.
      if (error instanceof RatingSubmissionBusyError) throw new ApiError('NOT_READY');
      throw error;
    }
  }
}
