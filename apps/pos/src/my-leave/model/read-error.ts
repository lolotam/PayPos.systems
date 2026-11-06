export class LeaveHttpError extends Error {
  constructor(
    code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function leaveReadRefused(error: unknown): boolean {
  return error instanceof LeaveHttpError && [401, 403, 404].includes(error.status);
}

export function leaveSessionRefused(error: unknown): boolean {
  return error instanceof LeaveHttpError && error.status === 401;
}
