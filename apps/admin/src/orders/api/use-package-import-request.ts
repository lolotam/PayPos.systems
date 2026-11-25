'use client';
import { useCallback, useReducer, useRef } from 'react';

/** حالة الطلب: المعاينة المقبولة الجارية، وهل قُبل طلب حفظها. */
type PackageImportRequestState = {
  previewId: string | undefined;
  commitAccepted: boolean;
};

const INITIAL_STATE: PackageImportRequestState = { previewId: undefined, commitAccepted: false };

type PackageImportRequestAction =
  | { kind: 'reset' }
  | { kind: 'preview'; previewId: string }
  | { kind: 'commit'; previewId: string };

function requestReducer(
  state: PackageImportRequestState,
  action: PackageImportRequestAction,
): PackageImportRequestState {
  switch (action.kind) {
    case 'reset':
      return INITIAL_STATE;
    case 'preview':
      return { previewId: action.previewId, commitAccepted: false };
    case 'commit':
      // الحفظ لمعاينة غير الجارية يُهمل: المعاينة بُدّلت أثناء الطلب.
      if (state.previewId !== undefined && state.previewId !== action.previewId) return state;
      return { previewId: action.previewId, commitAccepted: true };
  }
}

/**
 * حالة طلب استيراد الباقات مع حارس سباق: كل محاولة تحمل رمز الجلسة، وأي استجابة تصل بعد
 * تغيير الملف أو إعادة الضبط تُهمل فلا تكتب فوق الحالة الحالية.
 */
export function usePackageImportRequest() {
  const [state, dispatch] = useReducer(requestReducer, INITIAL_STATE);
  const tokenRef = useRef(0);
  const currentToken = useCallback(() => tokenRef.current, []);
  const restart = useCallback(() => {
    tokenRef.current += 1;
    dispatch({ kind: 'reset' });
  }, []);
  const acceptPreview = useCallback((token: number, previewId: string) => {
    if (token !== tokenRef.current) return;
    dispatch({ kind: 'preview', previewId });
  }, []);
  const acceptCommit = useCallback((token: number, previewId: string) => {
    if (token !== tokenRef.current) return;
    dispatch({ kind: 'commit', previewId });
  }, []);
  return { ...state, currentToken, restart, acceptPreview, acceptCommit };
}
