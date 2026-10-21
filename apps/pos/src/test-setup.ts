import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// أول اختبار في كل ملف بيدفع تكلفة أول رندر (jsdom + React + أول استعلامات) وتحت ضغط الـ CI بياخد
// أكتر من مهلة Testing Library الافتراضية (1000ms) فيفشل findBy* قبل ما العنصر يظهر (#436).
// المهلة سقف للانتظار مش sleep: findBy* بيرجع أول ما العنصر يظهر، و4000ms أقل من مهلة vitest (5000ms)
// عشان الفشل الحقيقي يطلع برسالة Testing Library وشجرة الـ DOM.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});

// jsdom has no Web Locks; the POS requires them (boot-device.ts), so tests get an in-process lock with the same
// contract: one holder per name at a time, released when the callback settles.
if (globalThis.navigator.locks === undefined) {
  const held = new Map<string, Promise<unknown>>();
  const request = (name: string, run: () => Promise<unknown>) => {
    const next = (held.get(name) ?? Promise.resolve()).then(run, run);
    held.set(
      name,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };
  Object.defineProperty(globalThis.navigator, 'locks', { value: { request }, configurable: true });
}
