export function totpSecret(uri: string): string | undefined {
  try {
    return new URL(uri).searchParams.get('secret') ?? undefined;
  } catch {
    return undefined;
  }
}
