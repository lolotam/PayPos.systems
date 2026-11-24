import { NotificationBellProbe } from './bell-probe';
import { PassthroughProvider } from './passthrough-provider';
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
  WorkspaceProvider: PassthroughProvider,
};

export const bellProbeMock = { NotificationBell: NotificationBellProbe };
