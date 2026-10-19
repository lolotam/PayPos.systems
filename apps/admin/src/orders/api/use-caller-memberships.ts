'use client';
import {
  myWorkspacesResponse,
  permissionMembershipPage,
  type PermissionMembership,
} from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

function unresolvedMemberships(found: readonly { id: string }[], wanted: readonly string[]) {
  const known = new Set(found.map((membership) => membership.id));
  return wanted.filter((membershipId) => !known.has(membershipId));
}

// نفس مفتاح شاشة الصلاحيات ومساحات الشِل، عشان التسمية تقرا البيانات الموجودة من غير endpoint جديد.
async function readMembershipPage(
  companyId: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const response = await apiClient().GET('/v1/permissions/memberships', {
    params: {
      header: { 'x-company-id': companyId },
      query: { limit: 20, ...(cursor ? { cursor } : {}) },
    },
    signal,
  });
  if (response.error) throw response.error;
  return permissionMembershipPage.parse(response.data);
}

// الاختيار اللي بعد أول 20 عضو بيتسمى من الصفحات الجاية؛ تكرار الـ cursor يوقف عشان الحوار ما يتعلّقش.
async function readFollowingPages(
  companyId: string,
  start: string | null,
  wanted: readonly string[],
  signal: AbortSignal,
): Promise<PermissionMembership[]> {
  const collected: PermissionMembership[] = [];
  const seen = new Set<string>();
  let cursor = start;
  while (cursor && !seen.has(cursor) && unresolvedMemberships(collected, wanted).length > 0) {
    seen.add(cursor);
    const page = await readMembershipPage(companyId, cursor, signal);
    collected.push(...page.items);
    cursor = page.next_cursor;
  }
  return collected;
}

async function readWorkspaces() {
  const response = await apiClient().GET('/v1/me/workspaces');
  if (response.error) throw response.error;
  return myWorkspacesResponse.parse(response.data);
}

export function useCallerMemberships(companyId: string, userId: string, wanted: readonly string[]) {
  const memberships = useQuery({
    queryKey: ['permissions', companyId, userId, null, 'memberships', undefined],
    queryFn: ({ signal }) => readMembershipPage(companyId, undefined, signal),
  });
  const pending = unresolvedMemberships(memberships.data?.items ?? [], wanted);
  const cursor = memberships.data?.next_cursor ?? null;
  // مفتاح لوحده: صفحة الصلاحيات الأولى تفضل صفحة واحدة، والباقي يتجمع هنا لحد ما الأسماء تكتمل.
  const following = useQuery({
    queryKey: ['permissions', companyId, userId, null, 'memberships', 'following', cursor, pending],
    enabled: memberships.isSuccess && Boolean(cursor) && pending.length > 0,
    queryFn: ({ signal }) => readFollowingPages(companyId, cursor, pending, signal),
  });
  const workspaces = useQuery({
    queryKey: ['me', 'workspaces'],
    queryFn: readWorkspaces,
  });
  return {
    memberships: [...(memberships.data?.items ?? []), ...(following.data ?? [])],
    companies: workspaces.data?.companies ?? [],
  };
}
