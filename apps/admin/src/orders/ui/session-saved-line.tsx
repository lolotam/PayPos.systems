'use client';
import type { SavedServiceLine } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import type { EditServiceLineResult } from '../api/use-edit-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { savedLineFigures, type SavedLineEdit } from '../model/session-saved-edit';
import { sessionBpsText } from '../model/session-recording-result';
import { EditServiceLineForm } from './edit-service-line-form';

const kwd = (value: string) => formatKwd(parseMoney(value));
const shown = (locale: Locale, row: { name_ar: string | null; name_en: string }) => (locale === 'ar' ? row.name_ar ?? row.name_en : row.name_en);
const warningFlags = [['not_clocked_in_warning', 'notClockedIn'], ['approved_leave_warning', 'approvedLeave']] as const;

export function SessionSavedLine({ line, edit, locale, when, sessionId, scope, online, open, canEdit, added, onOpen, onClose, onSaved, onForbidden }: {
  line: SavedServiceLine; edit?: SavedLineEdit; locale: Locale; when: string; sessionId: string;
  scope?: SessionServiceScope; online: boolean; open: boolean; canEdit: boolean; added: boolean;
  onOpen: () => void; onClose: () => void; onSaved: (result: EditServiceLineResult) => void; onForbidden: (message: string) => void;
}) {
  const figures = savedLineFigures(line, edit);
  const revision = edit?.revision ?? line.revision;
  return <li className="grid gap-2">
    <p>{shown(locale, line)} <Badge variant="secondary">{t(locale, 'serviceSessions.readOnly')}</Badge>
      {added ? <Badge variant="success">{t(locale, 'serviceSessions.newlySaved')}</Badge> : null}
      {/* العلامة من edited فقط؛ الإلغاء وتغيير المؤدي بيزودوا revision من غير تعديل سعر (FR-019). */}
      {edit?.edited === true || line.edited === true ? <Badge className="ms-2">{t(locale, 'serviceLineEdit.edited')}</Badge> : null}</p>
    {figures ? <dl><dt>{t(locale, 'serviceSessions.price')}</dt><dd><bdi>{kwd(figures.price)}</bdi></dd>
      <dt>{t(locale, 'serviceSessions.discountAmount')}</dt><dd><bdi>{kwd(figures.discount)}</bdi></dd>
      <dt>{t(locale, 'serviceSessions.savedNet')}</dt><dd><bdi>{kwd(figures.net)}</bdi></dd></dl>
      : <p>{t(locale, 'serviceLineEdit.figuresHidden')}</p>}
    {line.performers.map((performer) => {
      const name = shown(locale, performer);
      return <div key={performer.id}>
        <p>{name} <bdi>{t(locale, 'serviceSessions.percentValue').replace('{value}', sessionBpsText(performer.share_bps))}</bdi></p>
        {performer.not_clocked_in_warning || performer.approved_leave_warning ? <div role="status">
          {warningFlags.map(([flag, key]) => performer[flag] ? <p key={flag}>{name} — {when}: {t(locale, `serviceSessions.${key}`)}</p> : null)}
        </div> : null}
      </div>;
    })}
    {canEdit && line.status === 'ACTIVE' ? <Button type="button" variant="outline" onClick={onOpen}>{t(locale, 'serviceLineEdit.edit')}</Button> : null}
    {open && scope ? <EditServiceLineForm scope={scope} sessionId={sessionId} online={online} retryStaleOnce figuresKnown={figures !== null}
      line={{ id: line.id, price: figures?.price ?? '', discount: figures?.discount ?? '', net: figures?.net ?? '', revision }}
      onSaved={onSaved} onStale={() => undefined} onForbidden={onForbidden} onClose={onClose} /> : null}
  </li>;
}
