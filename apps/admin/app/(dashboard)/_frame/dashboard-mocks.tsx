import type { ReactNode } from 'react';

import { sessionMock, workspaceMock } from './frames/frame-test-support';

/** حالة الجلسة التي يقرؤها `useSession` المحاكى: خطأ قراءة الجلسة يُظهر التنبيه فوق الصفحة. */
export const sessionState = { isError: false };

export const dashboardSessionMock = {
  ...sessionMock,
  useSession: () => ({ isError: sessionState.isError }),
};

/** مساحة العمل المحاكاة مع مزوّدها الذي يمرّر الأبناء، لاختبار التخطيط والغلاف. */
export const dashboardWorkspaceMock = {
  ...workspaceMock,
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
};
