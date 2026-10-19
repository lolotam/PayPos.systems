import type { SavedServiceLine } from '@pospay/contracts';
import { savedLineFigures, type SavedVisitEdit } from './session-saved-edit';
import type { TipSourceLine } from './session-tip-source';

// أرقام التعديل عايشة على الزيارة مش على سناب شوت السطر. صافي سطر فعّال مجهول يخبي الاقتراح والتحذير.
export function savedVisitTipSource(
  lines: readonly SavedServiceLine[],
  visit: SavedVisitEdit,
): { lines: TipSourceLine[]; netsKnown: boolean } {
  let netsKnown = true;
  const source = lines.map((line) => {
    const figures = savedLineFigures(line, visit.lines[line.id]);
    if (line.status === 'ACTIVE' && figures === null) netsKnown = false;
    return {
      status: line.status,
      net: figures?.net ?? line.net,
      performers: line.performers.map((person) => ({
        employee_id: person.employee_id,
        share_bps: person.share_bps,
        name_ar: person.name_ar,
        name_en: person.name_en,
      })),
    };
  });
  return { lines: source, netsKnown };
}
