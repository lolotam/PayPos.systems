import type { EditServiceLineResponse } from '@pospay/contracts';

export type SavedLineEdit =
  | { edited: true; revision: number; figures: 'FROM_RESPONSE'; price: string; discount: string; net: string }
  | { edited: true; revision: number; figures: 'UNKNOWN' }
  | { edited: true; revision: number; figures: 'SNAPSHOT' };
export type SavedVisitEdit = {
  sessionId: string; total: 'SNAPSHOT' | 'FROM_RESPONSE' | 'UNKNOWN'; totalNet: string; lines: Record<string, SavedLineEdit>;
};
type SavedVisitSnapshot = { id: string; total_net: string; lines: readonly { id: string; revision: number }[] };

// الرد الضيق بيأكد الحفظ من غير أرقام، فالأرقام القديمة تتخبى؛ المراجعة مش مصدر علامة «اتعدّل» (FR-014، FR-019).
export function emptySavedVisit(sessionId: string, totalNet: string): SavedVisitEdit {
  return { sessionId, total: 'SNAPSHOT', totalNet, lines: {} };
}

export function savedLineFigures(line: { price: string; discount: string; net: string }, edit: SavedLineEdit | undefined) {
  if (edit?.figures === 'UNKNOWN') return null;
  if (edit?.figures === 'FROM_RESPONSE') return { price: edit.price, discount: edit.discount, net: edit.net };
  return { price: line.price, discount: line.discount, net: line.net };
}

// رد الإلحاق ممكن يكون اتظبط قبل ما التعديل يتسجل. مراجعة أقل من المؤكدة ما ترجعش أرقام اتأكدت أو اتخبت، والإجمالي القديم بيسقط السطور الملحقة فيفضل مجهول.
export function reconcileSavedVisit(visit: SavedVisitEdit, session: SavedVisitSnapshot): SavedVisitEdit {
  if (visit.sessionId !== session.id) return emptySavedVisit(session.id, session.total_net);
  const lines: Record<string, SavedLineEdit> = {};
  let keptOlder = false;
  for (const line of session.lines) {
    const edit = visit.lines[line.id];
    if (!edit) continue;
    if (line.revision < edit.revision) {
      lines[line.id] = edit;
      keptOlder = true;
      continue;
    }
    lines[line.id] = { edited: true, revision: line.revision, figures: 'SNAPSHOT' };
  }
  const uncoveredUnknown = Object.entries(visit.lines).some(([lineId, edit]) => {
    if (edit.figures !== 'UNKNOWN') return false;
    const incoming = session.lines.find((line) => line.id === lineId);
    return !incoming || incoming.revision < edit.revision;
  });
  if (uncoveredUnknown || keptOlder) return { sessionId: session.id, total: 'UNKNOWN', totalNet: visit.totalNet, lines };
  return { sessionId: session.id, total: 'SNAPSHOT', totalNet: session.total_net, lines };
}

export function applySavedLineEdit(visit: SavedVisitEdit, sessionId: string, lineId: string, response: EditServiceLineResponse, revisionUsed: number): SavedVisitEdit {
  // رد إعادة محاولة متأخر ما يكتبش فوق سناب شوت أحدث مراجعة منه.
  const known = visit.lines[lineId];
  const answered = 'line' in response ? response.line.revision : revisionUsed + 1;
  // مراجعة مساوية والأرقام معروفة (سناب شوت أو رد متطبّق) تفضل زي ما هي؛ أرقام «مجهولة» بمراجعة مساوية هي اللي رد الإعادة بيحلّها.
  if (known && (known.revision > answered || (known.revision === answered && known.figures !== 'UNKNOWN'))) return visit;
  if ('line' in response) {
    const line = response.line;
    return {
      sessionId, total: 'FROM_RESPONSE', totalNet: response.session.total_net,
      lines: { ...visit.lines, [lineId]: { edited: true, revision: line.revision, figures: 'FROM_RESPONSE', price: line.price, discount: line.discount, net: line.net } },
    };
  }
  return {
    sessionId, total: 'UNKNOWN', totalNet: visit.totalNet,
    lines: { ...visit.lines, [lineId]: { edited: true, revision: revisionUsed + 1, figures: 'UNKNOWN' } },
  };
}
