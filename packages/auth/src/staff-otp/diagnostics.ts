export type PreparationPhase = 'LOOKUP' | 'ELIGIBILITY' | 'PREPARATION' | 'ENQUEUE' | 'RELEASE';
export type PreparationFailure =
  | '55P03'
  | '57014'
  | '25P03'
  | 'OPERATION_FAILED'
  | 'BOUNDED_DATABASE_UNAVAILABLE'
  | 'BOUNDED_COMMIT_UNKNOWN'
  | 'BOUNDED_CONNECT_TIMEOUT';

export function phaseRunner(
  record?: (phase: PreparationPhase, failure: PreparationFailure) => void,
) {
  return async <T>(phase: PreparationPhase, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const value =
        error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
      const failure =
        value === '55P03' ||
        value === '57014' ||
        value === '25P03' ||
        value === 'BOUNDED_DATABASE_UNAVAILABLE' ||
        value === 'BOUNDED_COMMIT_UNKNOWN' ||
        value === 'BOUNDED_CONNECT_TIMEOUT'
          ? value
          : 'OPERATION_FAILED';
      record?.(phase, failure);
      throw error;
    }
  };
}
