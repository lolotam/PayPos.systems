'use client';

import type { AlertKindCode, ResetBranchAlertRuleQuery } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { alertRulesStatus, isAlertRulesRefusal } from '../model/alert-rules-failure';
import { alertRulesKey, alertRulesWriteKey, resetBranchAlertRule } from './alert-rules-client';

type ResetInput = { kind: AlertKindCode; expected: ResetBranchAlertRuleQuery };

export function useResetBranchAlertRule(
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  onDone: () => void,
  onConflict: () => void,
) {
  const client = useQueryClient();
  const key = alertRulesKey(companyId, userId, businessId, branchId);
  return useMutation({
    mutationKey: alertRulesWriteKey(companyId, userId, businessId),
    retry: false,
    mutationFn: ({ kind, expected }: ResetInput) =>
      resetBranchAlertRule(companyId, businessId, branchId, kind, expected),
    onSuccess: async () => {
      // طلب الاستبدال وإعلان الرجوع للقاعدة الأم بيتسجّلوا فورًا ويتطبّقوا عند أول قراءة ناجحة؛
      // فشل القراءة هنا ما بيضيّعهمش (issue #623).
      onDone();
      await client.refetchQueries({ queryKey: key, exact: true });
    },
    onError: async (error) => {
      if (!isAlertRulesRefusal(error) && alertRulesStatus(error) !== 409) return;
      if (alertRulesStatus(error) === 409) onConflict();
      await client.refetchQueries({ queryKey: key, exact: true });
    },
  });
}
