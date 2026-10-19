'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { RefObject } from 'react';
import type { SessionServiceScope } from '../api/use-session-services';
import { EditServiceLineForm } from './edit-service-line-form';

type Visit = DayPage['items'][number];
type Pages = readonly DayPage[];
type EditorList = {
  scope: SessionServiceScope;
  online: boolean;
  locale: Locale;
  mounted: RefObject<boolean>;
  refetchPages: () => Promise<Pages | null>;
  onAccessDenied: (message: string) => void;
};

export function ServiceSessionDayEditor({
  visitId,
  line,
  list,
  editing,
  releaseEdit,
  setNotice,
}: {
  visitId: string;
  line: Visit['lines'][number];
  list: EditorList;
  editing: { key: string; token: number };
  releaseEdit: (key: string, token: number) => void;
  setNotice: (message: string) => void;
}) {
  return (
    <EditServiceLineForm
      key={line.id}
      scope={list.scope}
      sessionId={visitId}
      line={line}
      online={list.online}
      onSaved={() => {
        releaseEdit(editing.key, editing.token);
        setNotice(t(list.locale, 'serviceLineEdit.saved'));
      }}
      onStale={async () => {
        if (!list.mounted.current) return null;
        const pages = await list.refetchPages();
        return pages ? revisionOf(pages, visitId, line.id) : null;
      }}
      onForbidden={(message) => {
        releaseEdit(editing.key, editing.token);
        setNotice(message);
      }}
      onAccessDenied={list.onAccessDenied}
      onClose={() => {
        releaseEdit(editing.key, editing.token);
      }}
    />
  );
}

// مراجعة السطر بتتاخد من صفحات الجلب اللي طلبه الـ 409؛ لو الجلب فشل أو السطر مش موجود مفيش رقم يتبعت.
function revisionOf(pages: readonly DayPage[], sessionId: string, lineId: string): number | null {
  for (const page of pages) {
    const match = page.items
      .find((item) => item.id === sessionId)
      ?.lines.find((item) => item.id === lineId);
    if (match) return match.revision;
  }
  return null;
}
