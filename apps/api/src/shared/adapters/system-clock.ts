import type { Clock } from '../ports/clock.port.ts';

// The only place in the API that reads the system clock for business decisions.
export const systemClock: Clock = { now: () => new Date() };
