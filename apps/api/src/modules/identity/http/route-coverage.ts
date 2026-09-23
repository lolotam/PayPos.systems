import type { Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';

import { PUBLIC_ROUTE } from '../../../shared/public.decorator.ts';
import { AUTHENTICATED_ONLY, REQUIRE_ACCESS } from './access.decorators.ts';

const MARKERS = [PUBLIC_ROUTE, AUTHENTICATED_ONLY, REQUIRE_ACCESS];

/**
 * Refuses to build an app with a route that declares no access: every handler must be @Public(),
 * @Authenticated() or @Require(…) (ADR-0003 §6, plan T9a-2 — "a route without a guard fails CI"). The access
 * guard also refuses such a route at request time; this check makes the mistake impossible to ship.
 *
 * @param controllers every controller the app mounts
 * @throws Error naming each unguarded Controller.method
 */
export function assertEveryRouteGuarded(controllers: readonly Type<unknown>[]): void {
  const unguarded: string[] = [];
  for (const controller of controllers) {
    if (Reflect.getMetadata(PUBLIC_ROUTE, controller) === true) continue;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      if (!MARKERS.some((marker) => Reflect.getMetadata(marker, handler) !== undefined)) {
        unguarded.push(`${controller.name}.${name}`);
      }
    }
  }
  if (unguarded.length > 0) {
    throw new Error(`routes without @Public, @Authenticated or @Require: ${unguarded.join(', ')}`);
  }
}
