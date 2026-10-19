import {
  updateBusinessIdentityNamesInput,
  type UpdateBusinessIdentityNamesInput,
} from '@pospay/contracts';

export type OfficialNames = {
  official_name_ar: string | null;
  official_name_en: string | null;
};

export type NameDraft = {
  official_name_ar: string;
  official_name_en: string;
};

export type DirtyNames = {
  official_name_ar?: boolean | undefined;
  official_name_en?: boolean | undefined;
};

export type NameChange =
  { ok: true; body: UpdateBusinessIdentityNamesInput } | { ok: false; reason: 'empty' | 'invalid' };

const KEYS = ['official_name_ar', 'official_name_en'] as const;

function nextValue(
  draft: string,
  baseline: string | null,
  known: boolean,
  dirty: boolean,
): string | null | undefined {
  const trimmed = draft.trim();
  if (!known) return dirty ? (trimmed === '' ? null : trimmed) : undefined;
  if (trimmed === (baseline ?? '')) return undefined;
  return trimmed === '' ? null : trimmed;
}

/** جسم الـ PATCH: مفتاح ناقص = بلا تغيير، والفارغ بعد التعديل = null. العقد يرفض الجسم الفاضي. */
export function changedOfficialNames(
  draft: NameDraft,
  baseline: OfficialNames | null,
  dirty: DirtyNames,
): NameChange {
  const known = baseline !== null;
  const body: UpdateBusinessIdentityNamesInput = {};
  for (const key of KEYS) {
    const value = nextValue(draft[key], baseline?.[key] ?? null, known, Boolean(dirty[key]));
    if (value !== undefined) body[key] = value;
  }
  if (Object.keys(body).length === 0) return { ok: false, reason: 'empty' };
  const parsed = updateBusinessIdentityNamesInput.safeParse(body);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  return { ok: true, body: parsed.data };
}
