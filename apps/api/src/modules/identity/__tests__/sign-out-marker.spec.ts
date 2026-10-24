import type { Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { expect, it } from 'vitest';

import { API_CONTROLLERS } from '../../../app.ts';
import { SIGN_OUT_ROUTE } from '../../../shared/sign-out.guard.ts';

// كل handler هاتحطه Nest على أي controller، بأي verb: نفس المشي اللي بيعمله تغطية المسارات في
// التطبيق، عشان علامة الخروج ما تختفيش على GET أو على write مش مسجل.
function mountedHandlers(controller: Type<unknown>): Map<string, object> {
  const seen = new Set<string>();
  const found = new Map<string, object>();
  for (
    let prototype = controller.prototype as object | null;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
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

// The sign-out marker switches session authentication off for the handler that carries it, so it may sit on
// the two sign-out handlers only. The allowlist walk never sees a GET or a record-scoped write, so this one
// walks every mounted handler of every controller instead.
it('the sign-out marker sits on the two sign-out handlers and on no other handler', () => {
  const marked: Record<string, string> = {};
  for (const controller of API_CONTROLLERS) {
    for (const [name, handler] of mountedHandlers(controller)) {
      const signOut: unknown = Reflect.getMetadata(SIGN_OUT_ROUTE, handler);
      if (signOut !== undefined) marked[`${controller.name}.${name}`] = signOut as string;
    }
  }
  expect(marked).toEqual({
    'PersonalOtpController.signOut': 'personal',
    'StaffOtpController.signOut': 'staff',
  });
});
