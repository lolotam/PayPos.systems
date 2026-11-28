import { signOutResult } from '@pospay/contracts';

import { personalCalls } from '@/personal-staff/api/personal-calls';
import { announcePersonalChange } from '@/personal-staff/model/session-change';
import { disablePushOnSignOut } from '@/personal-staff/push/push-disable';
import {
  onLateAbortedNativeResponse,
  parseNativeResponseJson,
  type LateAbortedNativeResponse,
} from '@/shared/api/native-staff-fetch';

/**
 * بيخرج الجلسة الشخصية من السيرفر ويوقف إشعارات الموظفة القديمة على الجهاز.
 * تنظيف الإشعارات بيتم الأول وهو نفسه ما بيمنعش الخروج، عشان الجهاز يتغيّر بأمان:
 * الشبكة best effort والسجل المحلي مضمون (ADR-0052 §7).
 * والانتظار بيتلغى مع الإشارة، فالمهمة المعلّقة ما بتقفلش الشاشة ولا بتطمسش جلسة أحدث.
 *
 * جواب «مفيش جلسة تخلص» بيعدّ نجاح: الكوكي HttpOnly، فالتطبيق مش شايف أصلاً إن
 * فيه جلسة ولا لأ، وسيرفر هو اللي جاوب صراحةً (spec 067) — وده هو الدليل الوحيد.
 * أي حاجة تانية (رفض، جواب غامض، شبكة مقطوعة) معناها الجلسة لسه شغالة.
 *
 * @param signal إشارة إلغاء اختيارية: المتصل بيلغي الطلب عشان جواب متأخر ما يمسحش جلسة أحدث
 * @returns «done» لما السيرفر أكّد، و«failed» لما رفض أو الشبكة وقعت أو الطلب اتلغى
 */
export async function endPersonalSession(signal?: AbortSignal): Promise<'done' | 'failed'> {
  if (signal?.aborted) return 'failed';
  const cleaned = await waitOrAbort(disablePushOnSignOut(), signal);
  if (cleaned === 'aborted') return 'failed';
  if (signal?.aborted) return 'failed';
  try {
    await personalCalls.signOut(signal);
  } catch {
    return 'failed';
  }
  announcePersonalChange();
  return 'done';
}

/**
 * ينتظر الشغل لحد ما يخلص أو لحد ما الإشارة تلغيه.
 *
 * @param work الشغل اللي بنستناه
 * @param signal الإشارة اللي تلغي الانتظار
 * @returns «done» لما الشغل خلص، و«aborted» لما الإشارة اتلغت قبلها
 */
function waitOrAbort(work: Promise<unknown>, signal?: AbortSignal): Promise<'done' | 'aborted'> {
  if (signal === undefined) return work.then(() => 'done' as const);
  return new Promise<'done' | 'aborted'>((resolve, reject) => {
    const onAbort = () => resolve('aborted');
    if (signal.aborted) {
      resolve('aborted');
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve('done');
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

const PERSONAL_SIGN_OUT_PATH = '/v1/staff/personal-session/sign-out';

function isConfirmedLateSignOut(response: LateAbortedNativeResponse): boolean {
  if (response.method !== 'POST') return false;
  if (response.status < 200 || response.status >= 300) return false;
  try {
    if (new URL(response.url).pathname !== PERSONAL_SIGN_OUT_PATH) return false;
  } catch {
    return false;
  }
  return signOutResult.safeParse(parseNativeResponseJson(response)).success;
}

onLateAbortedNativeResponse((response) => {
  // الخروج الشخصي الملغي بمهلة قد ينجح فعلياً على الخادم لاحقاً، فإعلان التغيير يمنع بقاء شاشة شخصية قديمة.
  if (isConfirmedLateSignOut(response)) announcePersonalChange();
});
