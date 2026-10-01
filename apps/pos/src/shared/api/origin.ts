export function apiOrigin(): string {
  const value = import.meta.env.VITE_API_URL?.trim();
  if (!value) throw new Error('VITE_API_URL is not set');
  return value.replace(/\/+$/, '');
}
