export function apiOrigin(): string {
  const value = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!value) throw new Error('NEXT_PUBLIC_API_URL is not set');
  return value.replace(/\/+$/, '');
}
