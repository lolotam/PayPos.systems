'use client';

import type { PendingDevicesResponse, WorkspaceBranch } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { Label, NativeSelect, PageHeader, PageShell } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useDevicesScreen, type DevicesScope } from '../api/use-devices-screen';
import { ActiveDevicesSection } from '../ui/active-devices-section';
import { PairingCodeCard } from '../ui/pairing-code-card';
import { PendingDevicesSection } from '../ui/pending-devices-section';

type DeviceItem = PendingDevicesResponse['items'][number];
type DevicesScreen = ReturnType<typeof useDevicesScreen>;

function isForbidden(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

function itemsOf(pages: { items: DeviceItem[] }[] | undefined): DeviceItem[] {
  const seen = new Set<string>();
  const items: DeviceItem[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export function DevicesPage({
  scope,
  branches,
  onBranch,
}: {
  scope: DevicesScope;
  branches: WorkspaceBranch[];
  onBranch: (branchId: string) => void;
}) {
  const locale = useLocale();
  const screen = useDevicesScreen(scope);
  const timezone =
    branches.find((branch) => branch.id === scope.branchId)?.effective_timezone ?? 'UTC';

  if (isForbidden(screen.pending.error) || isForbidden(screen.active.error)) {
    return (
      <PageShell layout="list">
        <PageHeader title={t(locale, 'devices.title')} description={t(locale, 'devices.lead')} />
        <p role="alert" className="text-sm text-destructive">
          {t(locale, 'devices.forbidden')}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell layout="list">
      <PageHeader title={t(locale, 'devices.title')} description={t(locale, 'devices.lead')} />
      <DevicesBranchPicker branches={branches} branchId={scope.branchId} onBranch={onBranch} />
      <PairingCodeCard
        code={screen.issued?.code ?? null}
        remaining={screen.remaining}
        issuing={screen.issue.isPending}
        issuedAtLabel={
          screen.issued === null
            ? null
            : formatInstant(new Date(screen.issued.issuedAt), locale, timezone)
        }
        issueError={screen.issue.error}
        onGenerate={() => {
          screen.issue.mutate();
        }}
      />
      <DevicesLists screen={screen} timezone={timezone} />
    </PageShell>
  );
}

function DevicesLists({ screen, timezone }: { screen: DevicesScreen; timezone: string }) {
  const pending = itemsOf(screen.pending.data?.pages);
  const active = itemsOf(screen.active.data?.pages);
  return (
    <>
      <PendingDevicesSection
        items={pending}
        error={screen.pending.error}
        loading={screen.pending.isPending}
        fetching={screen.pending.isFetching}
        hasMore={screen.pending.hasNextPage}
        timezone={timezone}
        approving={screen.approve.isPending ? (screen.approve.variables ?? null) : null}
        refusing={screen.refusePending.isPending ? (screen.refusePending.variables ?? null) : null}
        actionError={screen.refusePending.error ?? screen.approve.error}
        onRefresh={() => {
          void screen.pending.refetch();
        }}
        onMore={() => {
          void screen.pending.fetchNextPage();
        }}
        onApprove={(deviceId) => {
          screen.approve.mutate(deviceId);
        }}
        onRefuse={(deviceId) => {
          screen.refusePending.mutate(deviceId);
        }}
      />
      <ActiveDevicesSection
        items={active}
        error={screen.active.error}
        loading={screen.active.isPending}
        fetching={screen.active.isFetching}
        hasMore={screen.active.hasNextPage}
        timezone={timezone}
        removing={screen.removeActive.isPending ? (screen.removeActive.variables ?? null) : null}
        actionError={screen.removeActive.error}
        onMore={() => {
          void screen.active.fetchNextPage();
        }}
        onRemove={(deviceId) => {
          screen.removeActive.mutate(deviceId);
        }}
      />
    </>
  );
}

function DevicesBranchPicker({
  branches,
  branchId,
  onBranch,
}: {
  branches: WorkspaceBranch[];
  branchId: string;
  onBranch: (branchId: string) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="devices-branch">{t(locale, 'devices.branchLabel')}</Label>
      <NativeSelect
        id="devices-branch"
        className="w-56"
        value={branchId}
        onChange={(event) => onBranch(event.target.value)}
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
