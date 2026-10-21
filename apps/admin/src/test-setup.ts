import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
});

// أول اختبار في كل ملف بيدفع تكلفة أول رندر (jsdom + React + أول استعلامات) وتحت ضغط الـ CI بياخد
// أكتر من مهلة Testing Library الافتراضية (1000ms) فيفشل findBy* قبل ما العنصر يظهر (#436).
// المهلة سقف للانتظار مش sleep: findBy* بيرجع أول ما العنصر يظهر، و4000ms أقل من مهلة vitest (5000ms)
// عشان فشل أول انتظار يطلع برسالة Testing Library وشجرة الـ DOM. انتظار تاني بيفشل بعد أول واحد بطيء
// ممكن يعدّي الـ 5000ms ويطلع timeout عادي بتاع vitest، وده مقبول لأنه مابيغيّرش نتيجة الاختبار.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
