import { describe, expect, it } from 'vitest';

import { readAccessProof } from './read-access-proof';

type ProofQuery = Parameters<typeof readAccessProof>[0];

interface ProofState {
  isError: boolean;
  error: Error | null;
  isSuccess: boolean;
  isFetchedAfterMount: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
}

/** حالة قراءة كما يراها الخطاف: كل الحقول من اختيار واحد، والحالة المطلوبة فوقها. */
function proofOf(state: Partial<ProofState>): ProofQuery {
  return {
    isError: false,
    error: null,
    isSuccess: false,
    isFetchedAfterMount: false,
    fetchStatus: 'idle',
    ...state,
  } as ProofQuery;
}

/** خطأ بحالة HTTP، زي ما رد الـ API بيوصل للعميل. */
const failure = (status: number): Error => ({ status }) as unknown as Error;

const PAUSED = { fetchStatus: 'paused' } as const;

const pausedBeforeAnswer: [string, Partial<ProofState>][] = [
  ['a first read that has no answer yet', {}],
  ['a cached success', { isSuccess: true }],
  ['a cached refusal', { isError: true, error: failure(403) }],
  ['a cached unauthorized answer', { isError: true, error: failure(401) }],
  ['a cached failure', { isError: true, error: failure(500) }],
];

const answeredBeforeThePause: [string, Partial<ProofState>, string][] = [
  ['a success', { isSuccess: true }, 'granted'],
  ['a refusal', { isError: true, error: failure(403) }, 'refused'],
  ['a failure', { isError: true, error: failure(500) }, 'failed'],
];

const notPaused: [string, Partial<ProofState>, string][] = [
  ['a success that answered', { isSuccess: true, isFetchedAfterMount: true }, 'granted'],
  ['a success that has not answered since the mount', { isSuccess: true }, 'pending'],
  ['a read with no answer yet', {}, 'pending'],
  ['an unauthorized answer', { isError: true, error: failure(401) }, 'refused'],
  ['a refusal', { isError: true, error: failure(403) }, 'refused'],
  ['a failure', { isError: true, error: failure(500) }, 'failed'],
  ['an answer with no status', { isError: true, error: null }, 'failed'],
];

describe('readAccessProof', () => {
  it.each(pausedBeforeAnswer)(
    'calls a read paused before it answered a failure (%s)',
    (_name, state) => {
      expect(
        readAccessProof(proofOf({ ...PAUSED, isFetchedAfterMount: false, ...state })),
      ).toBe('failed');
    },
  );

  it.each(answeredBeforeThePause)(
    'keeps the answer of %s that answered before the pause',
    (_name, state, expected) => {
      expect(
        readAccessProof(proofOf({ ...PAUSED, isFetchedAfterMount: true, ...state })),
      ).toBe(expected);
    },
  );

  it.each(notPaused)('reads a read that is not paused: %s', (_name, state, expected) => {
    for (const fetchStatus of ['idle', 'fetching'] as const) {
      expect(readAccessProof(proofOf({ ...state, fetchStatus }))).toBe(expected);
    }
  });
});
