import { WhatsappEnvelopeInvalidError } from '@pospay/contracts';
import { isWhatsappVerified } from './whatsapp-webhook-security.ts';
import { whatsappFailure } from './whatsapp-failure.ts';
import { Controller, Get, Post, Inject, Req, Res, HttpCode } from '@nestjs/common';
import { whatsappEnvelope, whatsappHandshake, type WhatsAppEnvelope } from '@pospay/contracts';
import { verifyWhatsappToken, type WhatsappWebhookConfiguration } from '@pospay/notifications';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../../shared/public.decorator.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { ReceiveWhatsappStop } from '../use-cases/receive-whatsapp-stop/receive-whatsapp-stop.ts';

export const WHATSAPP_WEBHOOK = Symbol('WHATSAPP_WEBHOOK');
export interface WhatsappIntake {
  readonly config: WhatsappWebhookConfiguration;
  readonly receive: ReceiveWhatsappStop;
  readonly scrub: (envelope: WhatsAppEnvelope) => Parameters<ReceiveWhatsappStop['execute']>[0];
}

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(@Inject(WHATSAPP_WEBHOOK) private readonly intake: WhatsappIntake | null) {}

  @Public()
  @Get()
  verify(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    if (this.intake === null) throw new ApiError('NOT_READY');
    const parsed = whatsappHandshake.safeParse(request.query);
    if (
      !parsed.success ||
      !verifyWhatsappToken(parsed.data['hub.verify_token'], this.intake.config.verifyToken)
    )
      throw new ApiError('FORBIDDEN');
    void reply.type('text/plain').code(200).send(parsed.data['hub.challenge']);
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() request: FastifyRequest): Promise<{ received: true }> {
    try {
      if (this.intake === null) throw new ApiError('NOT_READY');
      if (!isWhatsappVerified(request)) throw new ApiError('UNAUTHENTICATED');
      const parsed = whatsappEnvelope.safeParse(request.body);
      if (!parsed.success) throw new ApiError('BAD_REQUEST');
      let messages: Parameters<ReceiveWhatsappStop['execute']>[0];
      try {
        messages = this.intake.scrub(parsed.data);
      } catch (error) {
        if (error instanceof WhatsappEnvelopeInvalidError) throw new ApiError('BAD_REQUEST');
        const failure = whatsappFailure(error);
        request.log.warn(failure.diagnostic, 'whatsapp intake failed');
        if (failure.transient) throw new ApiError('NOT_READY');
        throw error;
      }
      try {
        await this.intake.receive.execute(messages);
      } catch (error) {
        const failure = whatsappFailure(error);
        request.log.warn(failure.diagnostic, 'whatsapp intake failed');
        if (failure.transient) throw new ApiError('NOT_READY');
        throw error;
      }
      return { received: true };
    } finally {
      request.body = undefined;
    }
  }
}
