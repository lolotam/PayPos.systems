import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import type { RefObject } from 'react';

type Visit = DayPage['items'][number];
type Pages = readonly DayPage[];
type Refetching = { mounted: RefObject<boolean>; refetchPages: () => Promise<Pages | null> };

// حالة السطر بتتاخد من جلب اليوم بعد الرفض؛ لو الجلب فشل أو السطر مش موجود الحوار يفضل على رسالة الرفض.
function refreshedLine(pages: readonly DayPage[], sessionId: string, lineId: string) {
  for (const page of pages) {
    const match = page.items
      .find((item) => item.id === sessionId)
      ?.lines.find((item) => item.id === lineId);
    if (match) return { status: match.status, revision: match.revision };
  }
  return null;
}

export async function refreshLineTarget(list: Refetching, sessionId: string, lineId: string) {
  if (!list.mounted.current) return null;
  const pages = await list.refetchPages();
  return pages ? refreshedLine(pages, sessionId, lineId) : null;
}

export function findLine(visits: readonly Visit[], key: string | null) {
  if (!key) return null;
  for (const visit of visits) {
    const line = visit.lines.find((item) => `${visit.id}:${item.id}` === key);
    if (line) return { visit, line };
  }
  return null;
}
