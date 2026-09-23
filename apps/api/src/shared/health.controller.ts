import { Controller, Get, Inject } from '@nestjs/common';

import { ApiError } from './errors.ts';
import { Public } from './public.decorator.ts';
import { probe, READINESS_CHECKS, type ReadinessCheck } from './readiness.ts';

@Controller()
export class HealthController {
  readonly #checks: readonly ReadinessCheck[];

  constructor(@Inject(READINESS_CHECKS) checks: readonly ReadinessCheck[]) {
    this.#checks = checks;
  }

  /** Process liveness only — no dependency is touched, so a Redis or DB outage never restarts the API. */
  @Get('health')
  @Public()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness — Postgres and Redis must both answer; otherwise 503 with the state of each. */
  @Get('ready')
  @Public()
  async ready(): Promise<{ status: 'ready'; checks: Record<string, 'up' | 'down'> }> {
    const result = await probe(this.#checks);
    if (!result.ok) throw new ApiError('NOT_READY', { checks: result.checks });
    return { status: 'ready', checks: result.checks };
  }
}
