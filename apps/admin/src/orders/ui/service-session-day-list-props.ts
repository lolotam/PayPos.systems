import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import type { RefObject } from 'react';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';

export type Visit = DayPage['items'][number];
export type Pages = readonly DayPage[];
export type ServiceSessionDayListProps = {
  scope: SessionServiceScope;
  visits: Visit[];
  locale: Locale;
  online: boolean;
  timezone: string;
  canCancel: boolean;
  canChangePerformers: boolean;
  canRecord: boolean;
  loadError: string | null;
  empty: boolean;
  onRetry: () => void;
  refetchPages: () => Promise<Pages | null>;
  mounted: RefObject<boolean>;
  onAccessDenied: (message: string) => void;
  tipAttempts?: RefObject<Map<string, UnresolvedTip>>;
};
