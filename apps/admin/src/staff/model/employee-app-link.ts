export function employeeAppPosOrigin(): string | undefined {
  // Next.js بيضمّن القيمة وقت البناء لما المتغير يتكتب بالشكل الحرفي ده فقط.
  return process.env.NEXT_PUBLIC_POS_URL;
}

export function whatsAppShareHref(line: string, link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${line}\n${link}`)}`;
}

export function isForbidden(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 403;
}
