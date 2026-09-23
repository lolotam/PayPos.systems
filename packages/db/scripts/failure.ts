/**
 * What an operator script prints when it fails. The operator's own input mistakes are shown as written; any other
 * failure shows only its class, Postgres code and constraint — a driver message carries the SQL and its parameters
 * (a password hash, a reset token, a connection string), so it is never printed (CLAUDE.md §8).
 *
 * @param error whatever the script threw
 * @returns a one-line diagnostic with no data from the database
 */
export function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'OperatorInputError') return error.message;
  const name = error instanceof Error ? error.name : 'Error';
  const cause = error instanceof Error ? error.cause : undefined;
  const pg = [error, cause].find(
    (value): value is { code?: unknown; constraint_name?: unknown } =>
      typeof value === 'object' && value !== null && 'code' in value,
  );
  const code = typeof pg?.code === 'string' ? ` ${pg.code}` : '';
  const constraint = typeof pg?.constraint_name === 'string' ? ` (${pg.constraint_name})` : '';
  return `${name}${code}${constraint}`;
}
