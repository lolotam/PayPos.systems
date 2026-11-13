import type {
  ApproveDiscountProposalsInput,
  DeviceApproveDiscountProposalsInput,
  DeviceRejectDiscountProposalsInput,
  DecideDiscountProposalsResponse,
  RejectDiscountProposalsInput,
} from '@pospay/contracts';

import { DiscountPinError } from '../../domain/discount-pin-error.ts';
import { SessionError } from '../../domain/session-error.ts';
import type {
  DiscountDecisionDevice,
  DiscountDeviceScopePort,
  DiscountPinApproverPort,
  DiscountPinOutcome,
} from '../../ports/discount-decision.port.ts';
import type { DecideDiscountProposalsUseCase } from '../decide-discount-proposals/decide-discount-proposals.usecase.ts';

export { DiscountPinError } from '../../domain/discount-pin-error.ts';

type DeviceDecisionInput = DeviceApproveDiscountProposalsInput | DeviceRejectDiscountProposalsInput;

interface PinDecisionRequest {
  decision: 'APPROVE' | 'REJECT';
  input: DeviceDecisionInput;
  device: DiscountDecisionDevice;
}

/** يثبّت صاحب الاعتماد برقمه السري على جهاز مقترن، ثم يفوّض قرار الخصم البعيد داخل معاملته. */
export class DecideDiscountByPinUseCase {
  constructor(
    private readonly pins: DiscountPinApproverPort,
    private readonly scope: DiscountDeviceScopePort,
    private readonly decide: DecideDiscountProposalsUseCase,
  ) {}

  async execute(request: PinDecisionRequest): Promise<DecideDiscountProposalsResponse> {
    const approver = await this.approver(request);
    const businessId = await this.scope.businessOf(request.device);
    if (businessId === null) throw new SessionError('FORBIDDEN');
    return this.decide.execute({
      companyId: request.device.companyId,
      userId: approver.userId,
      businessId,
      branchId: request.device.branchId,
      key: '',
      fingerprint: '',
      decision: request.decision,
      input: withoutPin(request.input),
      channel: {
        via: 'PIN',
        deviceId: request.device.deviceId,
        pinRevision: approver.pinRevision,
      },
    });
  }

  private async approver(request: PinDecisionRequest): Promise<{ userId: string; pinRevision: string }> {
    const outcome = await this.verify(request);
    if (outcome.kind === 'ok') {
      return { userId: outcome.userId, pinRevision: outcome.pinRevision };
    }
    if (outcome.kind === 'refused') throw new DiscountPinError('PIN_INVALID');
    if (outcome.kind === 'locked') throw new DiscountPinError('PIN_LOCKED');
    throw new DiscountPinError('TOO_MANY_REQUESTS');
  }

  private async verify(request: PinDecisionRequest): Promise<DiscountPinOutcome> {
    try {
      return await this.pins.verify({
        phone: request.input.phone,
        pin: request.input.pin,
        companyId: request.device.companyId,
        deviceId: request.device.deviceId,
        branchId: request.device.branchId,
      });
    } catch {
      throw new DiscountPinError('NOT_READY');
    }
  }
}

// الهاتف والرقم السري لا يعبران إلى حالة القرار: يُحذفان قبل أي أثر أو تدقيق أو حدث.
function withoutPin(
  input: DeviceDecisionInput,
): ApproveDiscountProposalsInput | RejectDiscountProposalsInput {
  const decision: {
    proposal_ids: string[];
    terms_hashes: string[];
    approver_membership_id?: string;
  } = { proposal_ids: input.proposal_ids, terms_hashes: input.terms_hashes };
  if (input.approver_membership_id !== undefined) {
    decision.approver_membership_id = input.approver_membership_id;
  }
  if ('reason' in input) return { ...decision, reason: input.reason };
  return decision;
}
