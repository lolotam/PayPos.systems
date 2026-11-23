import { useEffect } from 'react';

/** عدّاد تركيب الجرس: كل تركيب جديد (مفتاح مختلف) يزيده واحدًا. */
export const bellProbeState = { mounts: 0 };

/** عنصر اختبار: جرس إشعارات يكتب ما استلمه من خصائص ويعدّ مرات تركيبه. */
export function NotificationBellProbe(props: {
  companyId: string | undefined;
  userId: string | null;
  businessId: string | undefined;
}) {
  useEffect(() => {
    bellProbeState.mounts += 1;
  }, []);
  return (
    <button type="button">
      Notifications {props.companyId ?? 'none'}/{props.userId ?? 'none'}/{props.businessId ?? 'none'}
    </button>
  );
}
