import type { NavStyle } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

export async function saveAccountNavStyle(navStyle: NavStyle, signal: AbortSignal): Promise<void> {
  const { error, response } = await apiClient().PUT('/v1/me/preferences', { body: { navStyle }, signal });
  if (error !== undefined || !response.ok) throw new Error('PREFERENCE_SAVE_FAILED');
}
