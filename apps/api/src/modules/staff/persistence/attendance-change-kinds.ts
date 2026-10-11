import type {
  AttendanceChangeKind,
  AttendanceChangeKinds,
} from '../ports/attendance-change-kinds.port.ts';

export function createAttendanceChangeKinds(
  kinds: readonly AttendanceChangeKind[],
): AttendanceChangeKinds {
  const registry = new Map(kinds.map((kind) => [kind.code, kind]));
  if (registry.size !== kinds.length) throw new Error('DUPLICATE_ATTENDANCE_CHANGE_KIND');
  return { find: (code) => registry.get(code) ?? null };
}
