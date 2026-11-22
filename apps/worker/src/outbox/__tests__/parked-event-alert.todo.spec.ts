import { describe, it } from 'vitest';

// هيكل اختبارات تنبيه المالك لحدث عمولة موقوف (ADR-0012 §3، المجموعة 5): مسارا الإيقاف اليوم يسجّلان فقط
// (`deliver.ts` عند retryInMs === null، و`dispatch-loop.ts` عبر onExhausted). يُملأ مع تنفيذ 53-2.

describe('parked counted event: the owner alert', () => {
  it.todo('ADR-0012 group 5: a counted event parked after its last failed delivery raises one owner alert');
  it.todo('ADR-0012 group 5: a counted event parked by an expired lease (the exhausted-claim path) raises one owner alert');
  it.todo('ADR-0012 group 5: an event type outside the six counted types raises no owner alert when it parks');
  it.todo('ADR-0012 group 5: the alert carries the company and the event id and type only, never the payload');
  it.todo('ADR-0012 group 5: the alert is raised outside any approval transaction, so a rolled-back approval does not remove it');
  it.todo('ADR-0012 group 5: a failure to raise the alert is logged and never changes the delivery or the park outcome');
  it.todo('ADR-0012 group 5: the same parked event does not raise the alert twice');
  it.todo('ADR-0012 group 5: a parked event still counts as pending after the alert');
});
