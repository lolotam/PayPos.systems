import type { OwnServiceLine } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Card } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  branchName,
  formatBusinessDate,
  formatCancelledOn,
  formatLineTime,
  formatShare,
  hasService,
  serviceName,
} from '../model/work-format';

/**
 * سطر خدمة واحد: بيعرض بس الحقول الجاية في الرد، من غير عنوان فاضي ولا شرطة للحقل الممنوع (MY-02).
 * الخدمة الملغية متشطوبة مع «اتلغت» وتاريخ الإلغاء (MY-07).
 *
 * @param props.item صف «شغلي»
 * @param props.timeZone توقيت النشاط من رد «شغلي»؛ الوقت وتاريخ الإلغاء بيتعرضوا بيه دايماً
 */
export function WorkLineRow({ item, timeZone }: { item: OwnServiceLine; timeZone: string }) {
  const locale = useLocale();
  const field = (label: string, value: string) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
  return (
    <li>
      <Card className="grid gap-2 p-4">
        <p className="text-sm text-muted-foreground">{branchName(item, locale)}</p>
        <dl className={`grid grid-cols-2 gap-x-4 gap-y-1 ${item.cancelled ? 'line-through' : ''}`}>
          {item.date === undefined
            ? null
            : field(t(locale, 'myWork.date'), formatBusinessDate(item.date, locale))}
          {item.time === undefined
            ? null
            : field(t(locale, 'myWork.time'), formatLineTime(item.time, locale, timeZone))}
          {hasService(item) ? field(t(locale, 'myWork.service'), serviceName(item, locale)) : null}
          {item.customer_name === undefined
            ? null
            : field(t(locale, 'myWork.customer'), item.customer_name)}
          {item.list_price === undefined
            ? null
            : field(t(locale, 'myWork.listPrice'), item.list_price)}
          {item.discount === undefined ? null : field(t(locale, 'myWork.discount'), item.discount)}
          {item.net === undefined ? null : field(t(locale, 'myWork.net'), item.net)}
          {item.share_bps === undefined
            ? null
            : field(t(locale, 'myWork.share'), formatShare(item.share_bps))}
        </dl>
        <div className="flex flex-wrap gap-2">
          {item.late ? <Badge variant="warning">{t(locale, 'myWork.late')}</Badge> : null}
          {item.cancelled ? (
            <Badge variant="destructive">{t(locale, 'myWork.cancelled')}</Badge>
          ) : null}
          {item.cancelled && item.cancelled_at ? (
            <span className="text-sm">
              {t(locale, 'myWork.cancelledOn')}{' '}
              {formatCancelledOn(item.cancelled_at, locale, timeZone)}
            </span>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
