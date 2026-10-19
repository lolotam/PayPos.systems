import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';

import type { AuthenticatedWriteDeclarations } from './authenticated-writes.ts';

import { PUBLIC_ROUTE } from '../../../shared/public.decorator.ts';
import {
  AUTHENTICATED_ONLY,
  REQUIRE_ACCESS,
  REQUIRE_PLATFORM,
} from '../../../shared/access.decorators.ts';

const MARKERS = [PUBLIC_ROUTE, AUTHENTICATED_ONLY, REQUIRE_ACCESS, REQUIRE_PLATFORM];

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
 * Refuses to build an app unless every route declares exactly one access: @Public(), @Authenticated(),
 * @Require(…) or @RequirePlatform(…) — on the method, or @Public() on the class (ADR-0003 §6, plan T9a-2 — "a route without a guard fails
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
      `every route needs exactly one of @Public, @Authenticated, @Require or @RequirePlatform: ${problems.join(', ')}`,
    );
  }
}

const WRITE_METHODS = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
  RequestMethod.ALL,
]);

function isAuthenticatedWrite(handler: object): boolean {
  if (Reflect.getMetadata(AUTHENTICATED_ONLY, handler) === undefined) return false;
  const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
  const listed = Array.isArray(method) ? method : [method];
  return listed.some((item) => typeof item === 'number' && WRITE_METHODS.has(item));
}

/**
 * Mounted @Authenticated() writes, named Controller.method the same way assertEveryRouteGuarded names a route.
 * A session-only GET is not declared: the list exists so a write cannot rely on the marker alone (PP-7.1).
 *
 * @param controllers every controller the app mounts
 * @returns keys the declaration list must cover, without starting the server
 */
export function authenticatedWriteKeys(controllers: readonly Type<unknown>[]): string[] {
  const keys: string[] = [];
  for (const controller of controllers) {
    for (const [name, handler] of handlers(controller)) {
      if (isAuthenticatedWrite(handler as object)) keys.push(`${controller.name}.${name}`);
    }
  }
  return keys;
}

/**
 * Refuses to start when an @Authenticated() write is missing from the declaration list. POST, PUT, PATCH,
 * DELETE and ALL count; the method comes from Nest's METHOD_METADATA, not the path. Record-scoped and personal
 * checks cannot be one static permission (PP-7.2), so the missing name is the same startup failure as an unguarded route.
 *
 * @param controllers every controller the app mounts, including test-only ones
 * @param declarations the allowlist keyed Controller.method
 * @throws Error naming each undeclared Controller.method
 */
export function assertAuthenticatedWritesDeclared(
  controllers: readonly Type<unknown>[],
  declarations: AuthenticatedWriteDeclarations,
): void {
  const missing = authenticatedWriteKeys(controllers).filter((key) => declarations[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `@Authenticated write routes must declare where their check lives: ${missing.join(', ')}`,
    );
  }
}
