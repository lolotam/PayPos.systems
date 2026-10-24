import { personalCalls } from '@/personal-staff/api/personal-calls';
import { announcePersonalChange } from '@/personal-staff/model/session-change';
import { disablePushOnSignOut } from '@/personal-staff/push/push-disable';

/**
 * بيخرج الجلسة الشخصية من السيرفر ويوقف إشعارات الموظفة القديمة على الجهاز.
 * تنظيف الإشعارات بيتم الأول وهو نفسه ما بيمنعش الخروج، عشان الجهاز يتغيّر بأمان.
 *
 * جواب «مفيش جلسة تخلص» بيعدّ نجاح: الكوكي HttpOnly، فالتطبيق مش شايف أصلاً إن
 * فيه جلسة ولا لأ، وسيرفر هو اللي جاوب صراحةً (spec 067) — وده هو الدليل الوحيد.
 * أي حاجة تانية (رفض، جواب غامض، شبكة مقطوعة) معناها الجلسة لسه شغالة.
 *
 * @returns «done» لما السيرفر أكّد، و«failed» لما رفض أو الشبكة وقعت
 */
export async function endPersonalSession(): Promise<'done' | 'failed'> {
  await disablePushOnSignOut();
  try {
    await personalCalls.signOut();
  } catch {
    return 'failed';
  }
  announcePersonalChange();
  return 'done';
}
