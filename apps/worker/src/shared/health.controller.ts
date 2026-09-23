import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

/**
 * One dependency `/ready` must reach. `/health` never runs these.
 */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

const TIMEOUT_MS = 2_000;

// A dependency that hangs must not hang /ready: the orchestrator polls it and needs a prompt answer.
async function probeOne({ name, check }: ReadinessCheck): Promise<[string, 'up' | 'down']> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return [name, 'up'];
  } catch {
    return [name, 'down'];
  } finally {
    clearTimeout(timer);
  }
}

@Controller()
export class HealthController {
  readonly #checks: readonly ReadinessCheck[];

  constructor(@Inject(READINESS_CHECKS) checks: readonly ReadinessCheck[]) {
    this.#checks = checks;
  }

  /** Process liveness only — a Postgres or Redis outage never restarts the worker. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness — Postgres and Redis must both answer; otherwise 503 in the error envelope. */
  @Get('ready')
  async ready(@Res() reply: FastifyReply): Promise<void> {
    const checks = Object.fromEntries(await Promise.all(this.#checks.map(probeOne)));
    if (Object.values(checks).every((state) => state === 'up')) {
      await reply.code(200).send({ status: 'ready', checks });
      return;
    }
    await reply.code(503).send({
      code: 'NOT_READY',
      message_ar: 'الخدمة غير جاهزة حالياً',
      message_en: 'The service is not ready',
      details: { checks },
    });
  }
}
