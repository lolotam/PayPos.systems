import { Controller, Post, Inject, Req, HttpCode } from '@nestjs/common';
import {
  isStoredResendFeedbackType,
  resendFeedbackEnvelope,
  resendFeedbackType,
} from '@pospay/contracts';
import { resendBounceClass, type ResendWebhookConfiguration } from '@pospay/notifications';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../../shared/public.decorator.ts';
import { ApiError } from '../../../shared/errors.ts';
import { verifiedResendDigest } from './resend-webhook-security.ts';
import type { ReceiveEmailFeedback } from '../use-cases/receive-email-feedback/receive-email-feedback.ts';

export const RESEND_WEBHOOK = Symbol('RESEND_WEBHOOK');
export interface ResendIntake {
  readonly config: ResendWebhookConfiguration;
  readonly receive: ReceiveEmailFeedback;
  /** ساعة الاستقبال للتوقيع: حقن صريح بدل Date.now على طول (§4.3). */
  readonly clock: { readonly now: () => Date };
}

@Controller('webhooks/resend')
export class ResendWebhookController {
  constructor(@Inject(RESEND_WEBHOOK) private readonly intake: ResendIntake | null) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() request: FastifyRequest): Promise<{ received: true }> {
    try {
      if (this.intake === null) throw new ApiError('NOT_READY');
      const digest = verifiedResendDigest(request);
      if (digest === undefined) throw new ApiError('UNAUTHENTICATED');
      const probe = resendFeedbackType.safeParse(request.body);
      if (!probe.success) throw new ApiError('BAD_REQUEST');
      // حدث مش من الستة: بيتأكد بـ 200 من غير تخزين (spec 075 FR-003).
      if (!isStoredResendFeedbackType(probe.data.type)) return { received: true };
      const parsed = resendFeedbackEnvelope.safeParse(request.body);
      if (!parsed.success) throw new ApiError('BAD_REQUEST');
      const providerTimestamp = new Date(parsed.data.created_at);
      if (Number.isNaN(providerTimestamp.getTime())) throw new ApiError('BAD_REQUEST');
      await this.intake.receive.execute({
        digest,
        type: parsed.data.type,
        emailId: parsed.data.data.email_id,
        bounceClass: resendBounceClass(parsed.data.data.bounce?.type),
        providerTimestamp,
        envelope: {
          type: parsed.data.type,
          created_at: parsed.data.created_at,
          email_id: parsed.data.data.email_id,
          ...(parsed.data.data.bounce === undefined
            ? {}
            : { bounce_type: parsed.data.data.bounce.type }),
        },
      });
      return { received: true };
    } finally {
      request.body = undefined;
    }
  }
}
