export type PairingNotice = 'refused' | 'removed';

export type DeviceScreenState =
  | { kind: 'loading' }
  | { kind: 'pairing'; notice: PairingNotice | null }
  | { kind: 'waiting' }
  | { kind: 'offline' }
  | { kind: 'unsupported' }
  | { kind: 'ready'; branchId: string };

export type MeResult =
  | { kind: 'ready'; branchId: string }
  | { kind: 'rejected' }
  | { kind: 'offline' };
