'use client';

import type { PendingDevicesResponse } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';

import { DeviceStates } from './device-states';

type DeviceItem = PendingDevicesResponse['items'][number];

type ActiveDevicesSectionProps = {
  items: DeviceItem[];
  error: unknown;
  loading: boolean;
  fetching: boolean;
  hasMore: boolean;
  timezone: string;
  removing: string | null;
  actionError: unknown;
  onMore: () => void;
  onRemove: (deviceId: string) => void;
};

// الأجهزة الفعالة: اللي تقدر تبيع في الفرع، وشيل واحد منها بيقطع صلاحيته على طول.
export function ActiveDevicesSection(props: ActiveDevicesSectionProps) {
  const locale = useLocale();
  const [toRemove, setToRemove] = useState<DeviceItem | null>(null);
  return (
    <section aria-labelledby="devices-active" className="flex flex-col gap-3">
      <h2 id="devices-active" className="text-lg font-semibold">
        {t(locale, 'devices.activeTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t(locale, 'devices.activeLead')}</p>
      <DeviceStates
        loading={props.loading}
        error={props.error}
        actionError={props.actionError}
        empty={props.items.length === 0}
        emptyText={t(locale, 'devices.activeEmpty')}
      />
      <ul className="flex flex-col gap-3">
        {props.items.map((device) => (
          <ActiveDeviceRow
            key={device.id}
            device={device}
            timezone={props.timezone}
            removing={props.removing === device.id}
            onRemove={() => setToRemove(device)}
          />
        ))}
      </ul>
      {props.hasMore ? (
        <Button type="button" variant="outline" onClick={props.onMore} disabled={props.fetching}>
          {t(locale, 'devices.loadMore')}
        </Button>
      ) : null}
      {toRemove === null ? null : (
        <RemoveDeviceDialog
          device={toRemove}
          onConfirm={() => {
            props.onRemove(toRemove.id);
            setToRemove(null);
          }}
          onClose={() => setToRemove(null)}
        />
      )}
    </section>
  );
}

function ActiveDeviceRow({
  device,
  timezone,
  removing,
  onRemove,
}: {
  device: DeviceItem;
  timezone: string;
  removing: boolean;
  onRemove: () => void;
}) {
  const locale = useLocale();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          {device.label}
          <Badge variant="success">{t(locale, 'devices.statusActive')}</Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          {t(locale, 'devices.lastSeenLabel')}:{' '}
          <span>
            {device.last_seen_at === null
              ? t(locale, 'devices.neverSeen')
              : formatInstant(new Date(device.last_seen_at), locale, timezone)}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t(locale, 'devices.pairedAtLabel')}:{' '}
          <span>{formatInstant(new Date(device.created_at), locale, timezone)}</span>
        </span>
      </div>
      <Button type="button" variant="destructive" onClick={onRemove} disabled={removing}>
        {t(locale, 'devices.remove')}
      </Button>
    </li>
  );
}

function RemoveDeviceDialog({
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
    <ModalDialog title={t(locale, 'devices.removeTitle')} onClose={onClose}>
      <p>{t(locale, 'devices.removeLead')}</p>
      <p className="font-medium">{device.label}</p>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" onClick={onConfirm}>
          {t(locale, 'devices.removeConfirm')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t(locale, 'devices.cancel')}
        </Button>
      </div>
    </ModalDialog>
  );
}
