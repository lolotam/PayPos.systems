import type { RatingRequestsSwitchPort } from '../ports/rating-requests-switch.port.ts';

export const RATING_REQUESTS_DEFAULT_ENABLED = false;

// جدول rating_settings يصل مع الصف 59-2؛ يُستبدل هذا المهايئ هناك بقراءة منه.
export const ratingRequestsSwitch: RatingRequestsSwitchPort = {
  enabled: async () => RATING_REQUESTS_DEFAULT_ENABLED,
};
