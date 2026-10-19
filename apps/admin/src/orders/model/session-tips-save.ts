import type { SessionTips } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { serviceSessionAccessRevoked } from './service-session-access';
import {
  conflictRevision,
  recorderMembershipIds,
  tipOutcomeKnown,
  tipRefusalMessage,
} from './session-tip-outcome';

export type TipSaveResult =
  | { kind: 'saved'; tips: SessionTips }
  | { kind: 'unknown'; message: string }
  | { kind: 'revoked'; message: string }
  | { kind: 'conflict'; tips: SessionTips | null; message: string }
  | { kind: 'refused'; message: string; memberships: string[] | null };

export async function commitSessionTips(args: {
  locale: Locale;
  mutate: () => Promise<SessionTips>;
  reload: () => Promise<SessionTips | null>;
}): Promise<TipSaveResult> {
  try {
    return { kind: 'saved', tips: await args.mutate() };
  } catch (error) {
    return classifyTipSave(error, args.locale, args.reload);
  }
}

async function classifyTipSave(
  error: unknown,
  locale: Locale,
  reload: () => Promise<SessionTips | null>,
): Promise<TipSaveResult> {
  const message = tipRefusalMessage(error, locale);
  if (serviceSessionAccessRevoked(error)) return { kind: 'revoked', message };
  if (conflictRevision(error) !== null) {
    const tips = await reload().catch(() => null);
    return { kind: 'conflict', tips, message };
  }
  if (!tipOutcomeKnown(error)) return { kind: 'unknown', message };
  return { kind: 'refused', message, memberships: recorderMembershipIds(error) };
}
