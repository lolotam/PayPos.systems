'use client';
import type {
  CustomerImportPreview,
  CustomerImportRow,
  CustomerImportRowsPage,
} from '@pospay/contracts';
import { useCallback, useReducer, useRef } from 'react';

/** حالة الطلب: المعاينة المعتمدة، والصفوف المحمّلة، ومؤشر الصفحة التالية. */
type CustomerImportRequestState = {
  preview: CustomerImportPreview | undefined;
  rows: CustomerImportRow[];
  nextCursor: string | null;
};

const INITIAL_STATE: CustomerImportRequestState = {
  preview: undefined,
  rows: [],
  nextCursor: null,
};

type CustomerImportRequestAction =
  | { kind: 'reset' }
  | { kind: 'preview'; preview: CustomerImportPreview }
  | { kind: 'rows'; previewId: string; page: CustomerImportRowsPage };

function requestReducer(
  state: CustomerImportRequestState,
  action: CustomerImportRequestAction,
): CustomerImportRequestState {
  switch (action.kind) {
    case 'reset':
      return INITIAL_STATE;
    case 'preview':
      return {
        preview: action.preview,
        rows: action.preview.rows,
        nextCursor: action.preview.next_cursor,
      };
    case 'rows':
      if (state.preview?.preview_id !== action.previewId) return state;
      return {
        ...state,
        rows: [...state.rows, ...action.page.items],
        nextCursor: action.page.next_cursor,
      };
  }
}

/**
 * حالة طلب الاستيراد مع حارس سباق: كل محاولة تحمل رمز الجلسة، وأي استجابة تصل بعد
 * تغيير الملف أو إعادة الضبط أو استبدال المعاينة تُهمل فلا تكتب فوق الحالة الحالية.
 */
export function useCustomerImportRequest() {
  const [state, dispatch] = useReducer(requestReducer, INITIAL_STATE);
  const tokenRef = useRef(0);
  const currentToken = useCallback(() => tokenRef.current, []);
  const restart = useCallback(() => {
    tokenRef.current += 1;
    dispatch({ kind: 'reset' });
  }, []);
  const acceptPreview = useCallback((token: number, preview: CustomerImportPreview) => {
    if (token !== tokenRef.current) return;
    dispatch({ kind: 'preview', preview });
  }, []);
  const acceptRows = useCallback(
    (token: number, previewId: string, page: CustomerImportRowsPage) => {
      if (token !== tokenRef.current) return;
      dispatch({ kind: 'rows', previewId, page });
    },
    [],
  );
  return { ...state, currentToken, restart, acceptPreview, acceptRows };
}
