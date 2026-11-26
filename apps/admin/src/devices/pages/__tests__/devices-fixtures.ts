export const SCOPE = {
  companyId: '01920000-0000-7000-8000-0000000000c1',
  businessId: '01920000-0000-7000-8000-0000000000b1',
  branchId: '01920000-0000-7000-8000-0000000000d1',
  userId: '01920000-0000-7000-8000-0000000000u1',
};
export const SECOND_BRANCH = {
  id: '01920000-0000-7000-8000-0000000000d2',
  name_ar: null,
  name_en: 'Garden branch',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
export const BRANCHES = [
  {
    id: SCOPE.branchId,
    name_ar: null,
    name_en: 'Till branch',
    effective_timezone: 'Asia/Kuwait',
    is_active: true,
  },
  SECOND_BRANCH,
];
export const TIMEZONE = 'Asia/Kuwait';

export const PENDING_DEVICE = {
  id: '01920000-0000-7000-8000-0000000000a1',
  label: 'Waiting till',
  created_at: '2026-11-26T08:00:00.000000Z',
  check_code: 'K7QP',
  last_seen_at: null,
};
export const SECOND_PENDING_DEVICE = {
  id: '01920000-0000-7000-8000-0000000000a2',
  label: 'Second till',
  created_at: '2026-11-26T07:00:00.000000Z',
  check_code: 'M3RT',
  last_seen_at: null,
};
export const SECOND_BRANCH_PENDING_DEVICE = {
  id: '01920000-0000-7000-8000-0000000000a4',
  label: 'Garden till',
  created_at: '2026-11-26T09:00:00.000000Z',
  check_code: 'P9X2',
  last_seen_at: null,
};
export const POLLED_DEVICE = {
  id: '01920000-0000-7000-8000-0000000000a3',
  label: 'Front Counter iPad',
  created_at: '2026-11-26T10:00:03.000000Z',
  check_code: 'W9M4',
  last_seen_at: null,
};
export const ACTIVE_DEVICE = {
  id: '01920000-0000-7000-8000-0000000000e1',
  label: 'Front till',
  created_at: '2026-11-20T08:00:00.000000Z',
  check_code: null,
  last_seen_at: '2026-11-25T09:30:00.000000Z',
};
export const ACTIVE_DEVICE_NEVER_SEEN = {
  ...ACTIVE_DEVICE,
  id: '01920000-0000-7000-8000-0000000000e2',
  label: 'New till',
  last_seen_at: null,
};
export const APPROVED_DEVICE = { ...PENDING_DEVICE, check_code: null };

export type GetOptions = {
  params: { path?: { branchId?: string }; query: { status?: string; cursor?: string } };
};

export function page(items: unknown[], next_cursor: string | null = null) {
  return { data: { items, next_cursor }, response: { status: 200 } };
}

export function refusal(message: { ar: string; en: string }, status = 404) {
  return {
    error: { code: 'NOT_FOUND', message_ar: message.ar, message_en: message.en },
    response: { status },
  };
}
