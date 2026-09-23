import { Controller, Get, Inject, SetMetadata } from '@nestjs/common';

import { ApiError } from './errors.ts';
import { probe, READINESS_CHECKS, type ReadinessCheck } from './readiness.ts';

// Marks a route as intentionally public (ADR-0003 §6). The permission guard (T9a) lets these through;
// every other route will need a permission.
export const PUBLIC_ROUTE = 'pospay:public-route';

@Controller()
export class HealthController {
  readonly #checks: readonly ReadinessCheck[];

  constructor(@Inject(READINESS_CHECKS) checks: readonly ReadinessCheck[]) {
    this.#checks = checks;
  }

  /** Process liveness only — no dependency is touched, so a Redis or DB outage never restarts the API. */
  @Get('health')
  @SetMetadata(PUBLIC_ROUTE, true)
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness — Postgres and Redis must both answer; otherwise 503 with the state of each. */
  @Get('ready')
  @SetMetadata(PUBLIC_ROUTE, true)
  async ready(): Promise<{ status: 'ready'; checks: Record<string, 'up' | 'down'> }> {
    const result = await probe(this.#checks);
    if (!result.ok) throw new ApiError('NOT_READY', { checks: result.checks });
    return { status: 'ready', checks: result.checks };
  }
}
