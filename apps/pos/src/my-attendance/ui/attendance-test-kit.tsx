import { fireEvent, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { json, renderWithProviders, replaceFetch } from '@/shared/testing/query-kit';

export { json, renderWithProviders, replaceFetch };

export type AttendanceSessionFixture = {
  id: string;
  working_date: string;
  branch_name_ar: string | null;
  branch_name_en: string;
  clock_in: string;
  clock_out: string | null;
  late_minutes: number;
  source: 'QR' | 'BARCODE' | 'MANUAL';
  status: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  open_exceptions: ('NONE' | 'OUT_OF_RANGE' | 'SUSPECTED_MISSED_OUT')[];
  corrected: boolean;
};

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

/** جلسة حضور كاملة: مغلقة، من غير تأخير ولا استثناءات. */
export const session = (extra: Partial<AttendanceSessionFixture> = {}): AttendanceSessionFixture => ({
  id: id(1),
  working_date: '2026-11-03',
  branch_name_ar: 'Kuwait branch AR',
  branch_name_en: 'Kuwait branch',
  clock_in: '2026-11-03T05:00:00.000Z',
  clock_out: '2026-11-03T13:00:00.000Z',
  late_minutes: 0,
  source: 'QR',
  status: 'CLOSED',
  open_exceptions: ['NONE'],
  corrected: false,
  ...extra,
});

/** رد السيرفر: الشهر وجلساته. */
export const month = (
  sessions: AttendanceSessionFixture[],
  name = '2026-11',
): { month: string; sessions: AttendanceSessionFixture[] } => ({ month: name, sessions });

/** رد فروع الموظفة (مصدر توقيت العرض على الموبايل الشخصي). */
export const branches = (timezone = 'Asia/Kuwait') => ({
  items: [{ id: id(5), name_ar: 'Kuwait branch AR', name_en: 'Kuwait branch', timezone }],
});

/** نافذة العرض الخاص المفتوحة. */
export const opened = (windowId = 'window-abc', idle = 60_000, cap = 300_000) => ({
  window_id: windowId,
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});

type Answer = Response | Promise<Response>;
type Handler = (request: Request, url: URL) => Answer;

export type Handlers = {
  attendance?: Handler;
  branches?: Handler;
  open?: Handler;
  touch?: Handler;
  close?: Handler;
};

/** سيرفر مزيف لشاشة «حضوري»: كل مسار له معالج، وغير كده 404. */
export function serve(handlers: Handlers = {}) {
  const requests: Request[] = [];
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  replaceFetch(async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith('/private-view/touch'))
      return (
        handlers.touch ?? (() => json({ idle_remaining_ms: 60_000, cap_remaining_ms: 250_000 }))
      )(request, url);
    if (path.endsWith('/private-view/close'))
      return (handlers.close ?? (() => new Response(null, { status: 204 })))(request, url);
    if (path.endsWith('/private-view'))
      return (handlers.open ?? (() => json(opened())))(request, url);
    if (path.endsWith('/staff/me/attendance'))
      return (handlers.attendance ?? (() => json(month([]))))(request, url);
    if (path.endsWith('/staff/me/branches'))
      return (handlers.branches ?? (() => json(branches())))(request, url);
    return json({ code: 'NOT_FOUND' }, 404);
  });
  const paths = (suffix: string) =>
    requests.filter((request) => new URL(request.url).pathname.endsWith(suffix));
  return { requests, paths };
}

/** فتح شاشة «حضوري» من زرها. */
export const openScreen = () =>
  fireEvent.click(screen.getByRole('button', { name: t('en', 'myAttendance.title') }));

/** كتابة الرقم السري وإرساله في خطوة الـ PIN. */
export const submitPin = async () => {
  fireEvent.change(await screen.findByLabelText(t('en', 'myAttendance.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(t('en', 'myAttendance.pinSubmit')));
};

/** العنصر ده (أو أي أب ليه) مخفي بالـ hidden أو display:none، يعني مفيش حاجة منه ظاهرة. */
export function isConcealed(node: Element): boolean {
  for (let el: Element | null = node; el; el = el.parentElement)
    if (el.hasAttribute('hidden') || (el as HTMLElement).style.display === 'none') return true;
  return false;
}
