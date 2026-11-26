import { describe, expect, it, vi } from 'vitest';
import type { PackageRefundNameFallback } from '../../domain/package-refund-notice.ts';
import type {
  PackageRefundNoticePorts,
  PackageRefundNoticeRequest,
} from '../../ports/package-refund-notice.port.ts';
import {
  RequestPackageRefundNotice,
  type PackageRefundNoticeInput,
} from './request-package-refund-notice.ts';

const baseInput: PackageRefundNoticeInput = {
  companyId: '01920000-0000-7000-8000-000000000001',
  sourceEventId: '01920000-0000-7000-8000-000000000002',
  businessId: '01920000-0000-7000-8000-000000000003',
  branchId: '01920000-0000-7000-8000-000000000004',
  entitlementId: '01920000-0000-7000-8000-000000000005',
  componentId: '01920000-0000-7000-8000-000000000006',
  refundId: '01920000-0000-7000-8000-000000000007',
  sessions: 2,
  amount: '4.500',
  businessDate: '2026-11-26',
  refundedAt: '2026-11-26T05:00:00.000Z',
  entitlementRevision: 2,
};

const fallback: PackageRefundNameFallback = {
  packageName: { ar: 'باقة', en: 'Package' },
  branch: { ar: 'الفرع', en: 'Branch' },
  safeName: (value) => value,
};

function makeHarness(overrides?: {
  matchesRefund?: boolean;
  companyOpen?: boolean;
  recipients?: readonly string[];
  branch?: { nameAr: string | null; nameEn: string } | null;
  claim?: boolean;
}) {
  const appended: Array<{ id: string; payload: PackageRefundNoticeRequest }> = [];
  let seq = 0;
  const ports: PackageRefundNoticePorts = {
    recipients: {
      companyOpen: vi.fn(async () => overrides?.companyOpen ?? true),
      branchManagerRecipients: vi.fn(async () => overrides?.recipients ?? ['user-1']),
    },
    place: {
      branchPlace: vi.fn(async () =>
        overrides && 'branch' in overrides
          ? (overrides.branch ?? null)
          : { nameAr: 'فرع رئيسي', nameEn: 'Main Branch' },
      ),
    },
    repository: {
      matchesRefund: vi.fn(async () => overrides?.matchesRefund ?? true),
      readRefundContext: vi.fn(async () => ({
        packageNameAr: 'باقة العناية',
        packageNameEn: 'Care Package',
        businessTimezone: 'Asia/Kuwait',
      })),
      claim: vi.fn(async () => overrides?.claim ?? true),
    },
    outbox: {
      append: vi.fn(async (id, payload) => {
        appended.push({ id, payload });
      }),
    },
  };
  const useCase = new RequestPackageRefundNotice(
    ports,
    { newId: () => `id-${++seq}` },
    { now: () => new Date('2026-11-26T05:00:05.000Z') },
    fallback,
  );
  return { useCase, ports, appended };
}

describe('RequestPackageRefundNotice', () => {
  it('throws PACKAGE_REFUND_EVENT_INVALID without claiming when the refund row does not match', async () => {
    const { useCase, ports, appended } = makeHarness({ matchesRefund: false });
    await expect(useCase.execute(baseInput)).rejects.toThrow('PACKAGE_REFUND_EVENT_INVALID');
    expect(ports.repository.claim).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it('returns without claiming when the company is no longer open', async () => {
    const { useCase, ports, appended } = makeHarness({ companyOpen: false });
    await useCase.execute(baseInput);
    expect(ports.repository.claim).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it('claims recipient_count = 0 and appends no notice when the branch is absent', async () => {
    const { useCase, ports, appended } = makeHarness({
      recipients: ['user-1', 'user-2'],
      branch: null,
    });
    await useCase.execute(baseInput);
    expect(ports.repository.claim).toHaveBeenCalledWith(baseInput, {
      id: 'id-1',
      sourceEventId: baseInput.sourceEventId,
      decidedAt: new Date('2026-11-26T05:00:05.000Z'),
      recipientCount: 0,
    });
    expect(appended).toHaveLength(0);
  });

  it('claims recipientCount = 105 and splits 105 recipients into batches of 100 and 5', async () => {
    const recipients = Array.from(
      { length: 105 },
      (_, index) => `user-${String(index + 1).padStart(3, '0')}`,
    );
    const { useCase, ports, appended } = makeHarness({ recipients });
    await useCase.execute(baseInput);
    expect(ports.repository.claim).toHaveBeenCalledWith(baseInput, {
      id: 'id-1',
      sourceEventId: baseInput.sourceEventId,
      decidedAt: new Date('2026-11-26T05:00:05.000Z'),
      recipientCount: 105,
    });
    expect(appended).toHaveLength(2);
    expect(appended[0]?.payload.notification_recipients).toHaveLength(100);
    expect(appended[1]?.payload.notification_recipients).toHaveLength(5);
  });
});
