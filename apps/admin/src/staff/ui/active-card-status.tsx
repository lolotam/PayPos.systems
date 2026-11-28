'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

// حالة الكارت النشط للموظف وإتاحة زر الإلغاء للمخوَّل بالإدارة.
export function ActiveCardStatus({
  active,
  canManage,
  revoking,
  onStartRevoke,
}: {
  active: { id: string; card_code_suffix?: string | null } | null;
  canManage: boolean;
  revoking: boolean;
  onStartRevoke: (cardId: string) => void;
}) {
  const locale = useLocale();
  if (active === null) return <p>{t(locale, 'employeeCard.none')}</p>;
  return (
    <div className="flex items-center justify-between gap-3">
      <span>
        {t(locale, 'employeeCard.active')}
        {active.card_code_suffix ? `: ••••${active.card_code_suffix}` : ''}
      </span>
      {canManage ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={revoking}
          onClick={() => onStartRevoke(active.id)}
        >
          {t(locale, 'employeeCard.revoke')}
        </Button>
      ) : null}
    </div>
  );
}
