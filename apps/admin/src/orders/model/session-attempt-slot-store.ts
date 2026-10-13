import { parseSessionJournalEnvelope, sameSessionScope, type SessionAttemptScope, type SessionJournalEnvelope } from './session-attempt';

const key = 'pospay:service-session-attempt';
const slots = [`${key}:a`, `${key}:b`] as const;
export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Slot = { key: string; generation: number; raw: string; envelope: SessionJournalEnvelope | null };

function parseSlot(slotKey: string, raw: string): Slot {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2 || !('generation' in value) || !('envelope' in value) ||
    !Number.isSafeInteger(value.generation) || typeof value.generation !== 'number' || value.generation < 1) throw new Error('SESSION_SLOT_INVALID');
  const envelope = value.envelope;
  const idle = envelope && typeof envelope === 'object' && Object.keys(envelope).length === 2 &&
    'version' in envelope && envelope.version === 1 && 'state' in envelope && envelope.state === 'IDLE';
  return { key: slotKey, generation: value.generation, raw, envelope: idle ? null : parseSessionJournalEnvelope(envelope) };
}

function scan(storage: JournalStorage | undefined) {
  const entries: Slot[] = []; let blocked = !storage;
  for (const slotKey of [...slots, key]) {
    let raw: string | null;
    try { raw = storage?.getItem(slotKey) ?? null; } catch { blocked = true; continue; }
    if (!raw) continue;
    try { entries.push(slotKey === key ? { key, generation: 0, raw, envelope: parseSessionJournalEnvelope(JSON.parse(raw)) } : parseSlot(slotKey, raw)); }
    catch { blocked = true; try { storage?.removeItem(slotKey); } catch { /* الإدخال المرفوض يظل محجوباً إن تعذر حذفه. */ } }
  }
  entries.sort((a, b) => b.generation - a.generation);
  if (entries[0] && entries[1]?.generation === entries[0].generation && entries[1].raw !== entries[0].raw) blocked = true;
  return { active: entries[0], blocked };
}

/** نحفظ البديل في الخانة الأخرى ونثبت محتواه قبل تقاعد آخر نسخة سليمة؛ فشل التخزين لا يمحو الزيارة. */
export function createSessionAttemptSlotStore(storage?: JournalStorage) {
  let active: Slot | undefined, generation = 0, blocked = false;
  const purge = () => {
    blocked = !storage;
    for (const slotKey of [...slots, key]) {
      try { if (storage?.getItem(slotKey) !== null) storage?.removeItem(slotKey); }
      catch { blocked = true; try { storage?.removeItem(slotKey); } catch { /* تغيير الهوية يبقى محجوباً إذا تعذر محو الخانة. */ } }
    }
    active = undefined; generation = 0;
  };
  return {
    get blocked() { return blocked; }, configure(backing?: JournalStorage) { storage = backing; }, purge,
    recover(scope: SessionAttemptScope | null) {
      const found = scan(storage); active = found.active; blocked = found.blocked; generation = active?.generation ?? 0;
      const envelope = active?.envelope;
      const place = envelope?.state === 'PENDING' ? envelope.attempt.scope : envelope?.scope;
      if (place && (!scope || !sameSessionScope(scope, place))) { purge(); return null; }
      return envelope ?? null;
    },
    write(envelope: SessionJournalEnvelope | null): boolean {
      if (!storage || blocked || generation === Number.MAX_SAFE_INTEGER) return false;
      const slotKey = active?.key === slots[0] ? slots[1] : slots[0];
      const raw = JSON.stringify({ generation: ++generation, envelope: envelope ?? { version: 1, state: 'IDLE' } });
      try {
        storage.setItem(slotKey, raw);
        if (storage.getItem(slotKey) !== raw) return false;
        const candidate = parseSlot(slotKey, raw), previous = active; active = candidate;
        if (previous && previous.key !== slotKey) { try { storage.removeItem(previous.key); } catch { /* ترتيب الأجيال يظل حاسماً إذا تعذر حذف النسخة الأقدم. */ } }
        return true;
      } catch { return false; }
    },
  };
}
