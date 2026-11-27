'use client';

import type { AlertKindCode, AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { buildAlertRulesDraft } from '../model/alert-rules-draft';

type AlertRulesForm = UseFormReturn<SetAlertRulesInput>;

/** طلب استبدال المسودة بقيم الخادم: كل القواعد أو أنواع محددة. */
export type AlertRulesReplaceRequest = {
  all: boolean;
  kinds: readonly AlertKindCode[];
  /** يُعرض إشعار «تم الرجوع للقاعدة الأم» عند التطبيق الفعلي بعد قراءة ناجحة. */
  notice?: 'reset';
  /** استبدال فوري على القيم الحالية بلا انتظار قراءة (مفيش قراءة جاية). */
  immediate?: boolean;
};

type PendingReplacement = AlertRulesReplaceRequest & { afterRead: number | null };

/**
 * يدمج طلب استبدال جديد مع طلب معلّق لسه ما اتطبّقش، عشان قراءة التعافي لما تفشل
 * وييجي طلب تاني ما يمسحش الطلب الأول (issue #623).
 *
 * @param previous     الطلب المعلّق الحالي (لو فيه)
 * @param next         الطلب الجديد
 * @param currentRead  لحظة آخر قراءة ناجحة وقت الطلب الجديد
 * @returns الطلب المعلّق بعد الدمج: اتحاد الأنواع، وأقدم لحظة قراءة، والإشعار الأحدث
 */
function mergePendingReplacement(
  previous: PendingReplacement | null,
  next: AlertRulesReplaceRequest,
  currentRead: number,
): PendingReplacement {
  const all = Boolean(previous?.all || next.all);
  const kinds = all ? [] : [...new Set([...(previous?.kinds ?? []), ...next.kinds])];
  const notice = next.notice ?? previous?.notice;
  const immediate = Boolean(next.immediate || previous?.immediate);
  const afterRead =
    next.immediate || previous?.afterRead === null ? null : (previous?.afterRead ?? currentRead);
  return {
    all,
    kinds,
    ...(notice ? { notice } : {}),
    ...(immediate ? { immediate } : {}),
    afterRead,
  };
}

/**
 * يزامن المسودة مع قيم الخادم. طلب الاستبدال بيتسجّل فورًا وبيفضل معلّقًا لحد أول قراءة ناجحة
 * بعد الطلب (تغيّر `dataUpdatedAt` حتى لو القيم متطابقة)، فلو قراءة التعافي فشلت ما يضيعش
 * الطلب ولا تتطبّق قيم قديمة؛ بعد التطبيق بيتمسح (issue #623).
 *
 * @param form            نموذج القواعد
 * @param server          قيم الخادم الأخيرة
 * @param serverUpdatedAt لحظة آخر قراءة ناجحة للنطاق ده
 * @param onApplied       ينادى لما طلب استبدال يتطبّق فعلًا
 * @returns دالة تسجيل طلب الاستبدال
 */
export function useSyncAlertRulesForm(
  form: AlertRulesForm,
  server: AlertRules,
  serverUpdatedAt: number,
  onApplied: (request: AlertRulesReplaceRequest) => void,
) {
  const [pending, setPending] = useState<PendingReplacement | null>(null);
  const updatedAt = useRef(serverUpdatedAt);
  updatedAt.current = serverUpdatedAt;
  const seen = useRef<string | null>(null);
  const requestReplace = useCallback((request: AlertRulesReplaceRequest) => {
    setPending((previous) => mergePendingReplacement(previous, request, updatedAt.current));
  }, []);
  useEffect(() => {
    const draft = buildAlertRulesDraft(server);
    const next = JSON.stringify(draft);
    const active =
      pending !== null && (pending.afterRead === null || pending.afterRead !== serverUpdatedAt)
        ? pending
        : null;
    if (active === null && seen.current === next) return;
    const replaceAll = active?.all === true;
    const resetKinds = new Set(active?.kinds ?? []);
    const kept = replaceAll
      ? []
      : draft.rules.flatMap((entry, index) =>
          !resetKinds.has(entry.kind) && form.getFieldState(`rules.${index}`).isDirty
            ? [{ index, value: form.getValues(`rules.${index}`) }]
            : [],
        );
    form.reset(draft);
    for (const entry of kept) {
      form.setValue(`rules.${entry.index}`, entry.value, { shouldDirty: true });
    }
    seen.current = next;
    if (active !== null) {
      setPending(null);
      onApplied(active);
    }
  }, [form, onApplied, pending, server, serverUpdatedAt]);
  return { requestReplace };
}
