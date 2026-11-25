'use client';
import type {
  ServiceImportPreview,
  ServiceImportRow,
  ServiceImportRowsPage,
} from '@pospay/contracts';
import { useCallback, useReducer, useRef } from 'react';

/** حالة الطلب: المعاينة المعتمدة، والصفوف المحمّلة، ومؤشر الصفحة التالية. */
type ServiceImportRequestState = {
  preview: ServiceImportPreview | undefined;
  rows: ServiceImportRow[];
  nextCursor: string | null;
};

const INITIAL_STATE: ServiceImportRequestState = {
  preview: undefined,
  rows: [],
  nextCursor: null,
};

type ServiceImportRequestAction =
  | { kind: 'reset' }
  | { kind: 'preview'; preview: ServiceImportPreview }
  | { kind: 'rows'; page: ServiceImportRowsPage };

function requestReducer(
  state: ServiceImportRequestState,
  action: ServiceImportRequestAction,
): ServiceImportRequestState {
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
      return {
        ...state,
        rows: [...state.rows, ...action.page.items],
        nextCursor: action.page.next_cursor,
      };
  }
}

/**
 * حالة طلب الاستيراد مع حارس سباق: كل محاولة تحمل رمز الجلسة، وأي استجابة تصل بعد
 * تغيير الملف أو إعادة الضبط تُهمل فلا تكتب فوق الحالة الحالية.
 */
export function useServiceImportRequest() {
  const [state, dispatch] = useReducer(requestReducer, INITIAL_STATE);
  const tokenRef = useRef(0);
  const currentToken = useCallback(() => tokenRef.current, []);
  const restart = useCallback(() => {
    tokenRef.current += 1;
    dispatch({ kind: 'reset' });
  }, []);
  const acceptPreview = useCallback((token: number, preview: ServiceImportPreview) => {
    if (token !== tokenRef.current) return;
    dispatch({ kind: 'preview', preview });
  }, []);
  const acceptRows = useCallback((token: number, page: ServiceImportRowsPage) => {
    if (token !== tokenRef.current) return;
    dispatch({ kind: 'rows', page });
  }, []);
  return { ...state, currentToken, restart, acceptPreview, acceptRows };
}
