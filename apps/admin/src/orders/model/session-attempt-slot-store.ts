import { hasNestedJournalPiiKey, hasUnknownJournalFields, isJournalPiiKey, parseSessionJournalEnvelope, sameSessionScope, type SessionAttemptScope, type SessionJournalEnvelope } from './session-attempt';

const key = 'pospay:service-session-attempt';
const slots = [`${key}:a`, `${key}:b`] as const;
export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Slot = { key: string; generation: number; raw: string; envelope: SessionJournalEnvelope | null };

function isIdleEnvelope(envelope: unknown): envelope is Record<string, unknown> {
  return !!envelope && typeof envelope === 'object' && !Array.isArray(envelope) &&
    'version' in envelope && envelope.version === 1 && 'state' in envelope && envelope.state === 'IDLE';
}

function parseSlot(slotKey: string, raw: string): Slot {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('generation' in value) || !('envelope' in value) ||
    !Number.isSafeInteger(value.generation) || typeof value.generation !== 'number' || value.generation < 1) throw new Error('SESSION_SLOT_INVALID');
  // حقل غلاف حساس يرفض الخانة؛ أي حقل غلاف تاني بيتجاهل عشان ما يمسحش زيارة سليمة.
  if (Object.entries(value).some(([field, child]) => field !== 'generation' && field !== 'envelope' && (isJournalPiiKey(field) || hasNestedJournalPiiKey(child)))) throw new Error('SESSION_SLOT_INVALID');
  const envelope = value.envelope;
  if (isIdleEnvelope(envelope)) {
    // مسودة IDLE من إصدار أحدث ممكن تشيل حقول زيادة؛ الحساس (مباشر أو متداخل) يرفض الخانة والمحايد يتنقى عند الاسترداد.
    if (Object.entries(envelope).some(([field, child]) => field !== 'version' && field !== 'state' && (isJournalPiiKey(field) || hasNestedJournalPiiKey(child)))) throw new Error('SESSION_SLOT_INVALID');
    return { key: slotKey, generation: value.generation, raw, envelope: null };
  }
  return { key: slotKey, generation: value.generation, raw, envelope: parseSessionJournalEnvelope(envelope) };
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
  function writeSlot(envelope: SessionJournalEnvelope | null): boolean {
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
  }
  return {
    get blocked() { return blocked; }, configure(backing?: JournalStorage) { storage = backing; }, purge,
    recover(scope: SessionAttemptScope | null) {
      const found = scan(storage); active = found.active; blocked = found.blocked; generation = active?.generation ?? 0;
      const envelope = active?.envelope;
      const place = envelope?.state === 'PENDING' ? envelope.attempt.scope : envelope?.scope;
      if (place && (!scope || !sameSessionScope(scope, place))) { purge(); return null; }
      if (active) {
        const stored = JSON.parse(active.raw) as Record<string, unknown>;
        const storedEnvelope: unknown = active.key === key ? stored : stored.envelope;
        // حقل غلاف غريب أو حقل زيادة جوه IDLE بينقّى بنفس إعادة كتابة المظروف، فتبقى الخانة فيها الصيغة القياسية بس.
        const unknownWrapper = active.key !== key && Object.keys(stored).some((field) => field !== 'generation' && field !== 'envelope');
        const unknownIdle = isIdleEnvelope(storedEnvelope) && Object.keys(storedEnvelope).some((field) => field !== 'version' && field !== 'state');
        if ((envelope && hasUnknownJournalFields(storedEnvelope)) || unknownWrapper || unknownIdle) {
          // فشل التنقية لا يستدعي الحذف: مفاتيح PII مرفوضة أصلًا، وحذف الخانة هنا قد يضيّع علامة PENDING.
          writeSlot(envelope ?? null);
        }
      }
      return envelope ?? null;
    },
    write(envelope: SessionJournalEnvelope | null): boolean { return writeSlot(envelope); },
  };
}
