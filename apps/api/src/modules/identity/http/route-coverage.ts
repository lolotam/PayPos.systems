import type { Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';

import { PUBLIC_ROUTE } from '../../../shared/public.decorator.ts';
import { AUTHENTICATED_ONLY, REQUIRE_ACCESS } from './access.decorators.ts';

const MARKERS = [PUBLIC_ROUTE, AUTHENTICATED_ONLY, REQUIRE_ACCESS];

// Every route handler Nest will mount, inherited ones included: walk the prototype chain the way Nest's metadata
// scanner does, keeping the most-derived definition of each name.
function handlers(controller: Type<unknown>): Map<string, unknown> {
  const seen = new Set<string>();
  const found = new Map<string, unknown>();
  for (
    let prototype = controller.prototype as object | null;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      // An override hides the base method even when it carries no route metadata — Nest mounts what it sees first.
      if (name === 'constructor' || seen.has(name)) continue;
      seen.add(name);
      const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value as unknown;
      if (
        typeof handler === 'function' &&
        Reflect.getMetadata(PATH_METADATA, handler) !== undefined
      ) {
        found.set(name, handler);
      }
    }
  }
  return found;
}

/**
 * Refuses to build an app unless every route declares exactly one access: @Public(), @Authenticated() or
 * @Require(…) — on the method, or @Public() on the class (ADR-0003 §6, plan T9a-2 — "a route without a guard fails
 * CI"). Two declarations are a conflict: a public class or a session-only marker would otherwise hide a
 * permission. The access guard also refuses an undeclared route at request time.
 *
 * @param controllers every controller the app mounts
 * @throws Error naming each unguarded or conflicting Controller.method
 */
export function assertEveryRouteGuarded(controllers: readonly Type<unknown>[]): void {
  const problems: string[] = [];
  for (const controller of controllers) {
    const publicClass = Reflect.getMetadata(PUBLIC_ROUTE, controller) === true ? 1 : 0;
    for (const [name, handler] of handlers(controller)) {
      const declared =
        publicClass +
        MARKERS.filter((marker) => Reflect.getMetadata(marker, handler as object) !== undefined)
          .length;
      if (declared !== 1) {
        problems.push(
          `${controller.name}.${name} (${declared === 0 ? 'unguarded' : 'conflicting'})`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `every route needs exactly one of @Public, @Authenticated or @Require: ${problems.join(', ')}`,
    );
  }
}
