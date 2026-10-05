import { present } from '../../../../../../../packages/db/test/present.ts';
import { describe, expect, it, vi } from 'vitest';
import { SendStaffOtp } from './send-staff-otp.ts';
import type { OtpExecution, OtpPending } from '../../ports/otp-execution.port.ts';

interface FixtureState {
  now: number;
  inside: boolean;
  status: string;
  active: boolean;
}
function pendingRow(): OtpPending {
  return {
    id: 'attempt',
    challengeId: 'challenge',
    recipientHash: Buffer.alloc(32, 4),
    locale: 'ar',
    providerTemplateName: 'synthetic_ar',
    status: 'PREPARED',
    preparationDeadline: new Date(200),
    sendDeadline: new Date(300000),
  };
}
function execution(state: FixtureState, row: OtpPending): OtpExecution {
  return {
    pending: vi.fn(async () => {
      state.inside = true;
      const result = { ...row, status: state.status };
      state.inside = false;
      return result;
    }),
    timeout: vi.fn(async () => {
      if (state.status === 'PREPARED') state.status = 'FAILED';
      return state.status;
    }),
    claim: vi.fn(async () => {
      if (state.status !== 'PENDING') return false;
      state.status = 'SENDING';
      return true;
    }),
    materialize: vi.fn(async () => ({
      phone: '+99900000001',
      code: String(7).padStart(6, '0'),
      deadline: row.sendDeadline,
    })),
    finish: vi.fn(async () => {
      state.status = 'SENT';
    }),
    readiness: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}
function fixture() {
  const state: FixtureState = { now: 0, inside: false, status: 'PREPARED', active: true };
  const auth = execution(state, pendingRow());
  const send = vi.fn(async () => ({
    status: 'SENT' as const,
    failureCode: 'PROVIDER_ACCEPTED' as const,
    outcomeKnown: true,
  }));
  const reserve = vi.fn(async () => true),
    ready = vi.fn(async () => state.active);
  const pause = vi.fn(async (delay: number) => {
    expect(state.inside).toBe(false);
    state.now += delay;
  });
  const diagnostic = vi.fn();
  const useCase = new SendStaffOtp(
    auth,
    { ready, available: () => state.active },
    { reserve },
    { valid: () => true, send },
    { now: () => new Date(state.now) },
    { newId: () => 'execution' },
    { pause },
    { record: diagnostic },
  );
  return {
    auth,
    send,
    reserve,
    pause,
    useCase,
    diagnostic,
    ready,
    setState: (value: string) => {
      state.status = value;
    },
    setTime: (value: number) => {
      state.now = value;
    },
    disable: () => {
      state.active = false;
    },
  };
}

describe('the same early execution waits without extending PREPARED authorization', () => {
  it('does not probe DB/Redis capabilities on each five millisecond PREPARED poll', async () => {
    const f = fixture();
    await f.useCase.execute('challenge', 'attempt');
    expect(f.pause.mock.calls.length).toBeGreaterThan(30);
    expect(f.ready).toHaveBeenCalledOnce();
  });
  it('finishes a known refusal and diagnoses capability loss after admission', async () => {
    const f = fixture();
    f.setState('PENDING');
    f.reserve.mockImplementationOnce(async () => {
      f.disable();
      return true;
    });
    await f.useCase.execute('challenge', 'attempt');
    expect(f.auth.finish).toHaveBeenCalledWith('challenge', 'attempt', null, {
      status: 'FAILED',
      failureCode: 'CONFIG_INVALID',
      outcomeKnown: true,
    });
    expect(f.diagnostic).toHaveBeenCalledWith('CAPABILITY_LOST');
    expect(f.auth.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});
describe('PREPARED release and timeout', () => {
  it('waits outside reads and sends exactly once only after release and acknowledged claim', async () => {
    const f = fixture();
    f.pause.mockImplementationOnce(async () => {
      expect(f.auth.materialize).not.toHaveBeenCalled();
      f.setState('PENDING');
    });
    await f.useCase.execute('challenge', 'attempt');
    expect(f.pause).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledOnce();
    expect(vi.mocked(f.auth.claim).mock.invocationCallOrder[0]).toBeLessThan(
      present(vi.mocked(f.auth.materialize).mock.invocationCallOrder[0]),
    );
    await f.useCase.execute('challenge', 'attempt');
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('times out at the fixed deadline with zero materialization/submissions and never retries', async () => {
    const f = fixture();
    await f.useCase.execute('challenge', 'attempt');
    expect(f.auth.timeout).toHaveBeenCalledOnce();
    expect(f.auth.materialize).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.pause.mock.calls.reduce((sum, [delay]) => sum + delay, 0)).toBe(200);
    await f.useCase.execute('challenge', 'attempt');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('can observe an on-time PENDING release at the final locked check', async () => {
    const f = fixture();
    f.setTime(200);
    f.auth.timeout = vi.fn(async () => {
      f.setState('PENDING');
      return 'PENDING';
    });
    await f.useCase.execute('challenge', 'attempt');
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('records a finite timeout persistence failure and grants no send permission', async () => {
    const f = fixture();
    f.setTime(200);
    vi.mocked(f.auth.timeout).mockRejectedValueOnce(new Error('SYNTHETIC_DATABASE_FAILURE'));
    await f.useCase.execute('challenge', 'attempt');
    expect(f.diagnostic).toHaveBeenCalledWith('PREPARATION_TIMEOUT_PERSISTENCE_FAILED');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.auth.claim).not.toHaveBeenCalled();
  });
});
describe('the same early execution waits without extending PREPARED authorization', () => {
  it('skips disabled capability and stops a waiting execution on capability loss', async () => {
    const f = fixture();
    f.disable();
    await f.useCase.execute('challenge', 'attempt');
    expect(f.auth.pending).not.toHaveBeenCalled();
    const waiting = fixture();
    waiting.pause.mockImplementationOnce(async () => waiting.disable());
    await waiting.useCase.execute('challenge', 'attempt');
    expect(waiting.send).not.toHaveBeenCalled();
    expect(waiting.auth.pending).toHaveBeenCalledOnce();
  });
  it('refuses admission without sleeping or claiming, and handles unknown claim with zero HTTP', async () => {
    const f = fixture();
    f.setState('PENDING');
    f.reserve.mockRejectedValueOnce(new Error('synthetic'));
    await f.useCase.execute('challenge', 'attempt');
    expect(f.auth.claim).not.toHaveBeenCalled();
    expect(f.pause).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    const uncertain = fixture();
    uncertain.setState('PENDING');
    uncertain.auth.claim = vi.fn(async () => false);
    await uncertain.useCase.execute('challenge', 'attempt');
    expect(uncertain.send).not.toHaveBeenCalled();
  });
});
