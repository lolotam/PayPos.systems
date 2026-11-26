'use client';

import type { PendingDevicesResponse } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';

import { DeviceStates } from './device-states';

type DeviceItem = PendingDevicesResponse['items'][number];

type PendingDevicesSectionProps = {
  items: DeviceItem[];
  error: unknown;
  loading: boolean;
  fetching: boolean;
  hasMore: boolean;
  timezone: string;
  approving: string | null;
  refusing: string | null;
  actionError: unknown;
  onRefresh: () => void;
  onMore: () => void;
  onApprove: (deviceId: string) => void;
  onRefuse: (deviceId: string) => void;
};

// الأجهزة المستنية موافقة: الصف بيعرض كود المطابقة عشان المدير يقارنه بشاشة الجهاز.
export function PendingDevicesSection(props: PendingDevicesSectionProps) {
  const locale = useLocale();
  const [toRefuse, setToRefuse] = useState<DeviceItem | null>(null);
  return (
    <section aria-labelledby="devices-pending" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="devices-pending" className="text-lg font-semibold">
          {t(locale, 'devices.pendingTitle')}
        </h2>
        <Button type="button" variant="outline" onClick={props.onRefresh} disabled={props.fetching}>
          {t(locale, 'devices.refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t(locale, 'devices.pendingLead')}</p>
      <DeviceStates
        loading={props.loading}
        error={props.error}
        actionError={props.actionError}
        empty={props.items.length === 0}
        emptyText={t(locale, 'devices.pendingEmpty')}
      />
      <ul className="flex flex-col gap-3">
        {props.items.map((device) => (
          <PendingDeviceRow
            key={device.id}
            device={device}
            timezone={props.timezone}
            approving={props.approving === device.id}
            refusing={props.refusing === device.id}
            onApprove={() => props.onApprove(device.id)}
            onRefuse={() => setToRefuse(device)}
          />
        ))}
      </ul>
      {props.hasMore ? (
        <Button type="button" variant="outline" onClick={props.onMore} disabled={props.fetching}>
          {t(locale, 'devices.loadMore')}
        </Button>
      ) : null}
      {toRefuse === null ? null : (
        <RefuseDeviceDialog
          device={toRefuse}
          onConfirm={() => {
            props.onRefuse(toRefuse.id);
            setToRefuse(null);
          }}
          onClose={() => setToRefuse(null)}
        />
      )}
    </section>
  );
}

function PendingDeviceRow({
  device,
  timezone,
  approving,
  refusing,
  onApprove,
  onRefuse,
}: {
  device: DeviceItem;
  timezone: string;
  approving: boolean;
  refusing: boolean;
  onApprove: () => void;
  onRefuse: () => void;
}) {
  const locale = useLocale();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{device.label}</span>
        <span className="text-xs text-muted-foreground">
          {t(locale, 'devices.requestedAt')}:{' '}
          <span>{formatInstant(new Date(device.created_at), locale, timezone)}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t(locale, 'devices.checkCodeLabel')}:{' '}
          <span
            data-testid="pending-device-check-code"
            dir="ltr"
            className="font-mono text-base font-bold tracking-[0.2em] text-foreground"
          >
            {device.check_code ?? '----'}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onApprove} disabled={approving}>
          {approving ? t(locale, 'devices.approving') : t(locale, 'devices.approve')}
        </Button>
        <Button type="button" variant="outline" onClick={onRefuse} disabled={refusing}>
          {t(locale, 'devices.refuse')}
        </Button>
      </div>
    </li>
  );
}

function RefuseDeviceDialog({
  device,
  onConfirm,
  onClose,
}: {
  device: DeviceItem;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <ModalDialog title={t(locale, 'devices.refuseTitle')} onClose={onClose}>
      <p>{t(locale, 'devices.refuseLead')}</p>
      <p className="font-medium">{device.label}</p>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" onClick={onConfirm}>
          {t(locale, 'devices.refuseConfirm')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t(locale, 'devices.cancel')}
        </Button>
      </div>
    </ModalDialog>
  );
}
