export type PairingNotice = 'refused' | 'removed';

export type DeviceScreenState =
  | { kind: 'loading' }
  | { kind: 'pairing'; notice: PairingNotice | null }
  | { kind: 'waiting'; checkCode?: string }
  | { kind: 'offline' }
  | { kind: 'unsupported'; canStartOver?: boolean }
  | { kind: 'ready'; branchId: string; deviceId?: string };

export type MeResult =
  | { kind: 'ready'; branchId: string; deviceId?: string }
  | { kind: 'rejected' }
  | { kind: 'offline' };
