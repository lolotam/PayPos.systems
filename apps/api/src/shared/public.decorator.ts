import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'pospay:public-route';

/**
 * Marks a route as reachable without a session. Every other route needs one (the session guard denies by
 * default), so this list is the reviewed exception: today /health and /ready; /v1/auth/* is mounted beside
 * Nest and handles its own requests (ADR-0003 §6).
 *
 * @returns the metadata decorator
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
