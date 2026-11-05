// Better Auth 1.7.5 لا يصدّر matchesOriginPattern؛ نطابق قواعده لأصول HTTP المعيارية فقط.
// المصدر: dist/auth/trusted-origins.mjs وdist/utils/wildcard.mjs؛ المطابقة حساسة لحالة الأحرف.
export function matchesTrustedOrigin(origin: string, pattern: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === origin;
  const candidate = pattern.includes('://') ? origin : new URL(origin).host;
  return new RegExp(`^${wildcardExpression(pattern)}$`).test(candidate);
}

function escapeLiteral(text: string): string {
  return text.replace(/[-^$+?.()|[\]{}*\\]/g, '\\$&');
}

function segmentExpression(segment: string): string {
  let expression = '';
  for (let index = 0; index < segment.length; index++) {
    const character = segment.charAt(index);
    if (character === '\\') {
      if (index + 1 < segment.length) expression += escapeLiteral(segment.charAt(++index));
    } else if (character === '?') expression += '[^/\\\\]';
    else if (character === '*') expression += '[^/\\\\]*?';
    else expression += escapeLiteral(character);
  }
  return expression;
}

function wildcardExpression(pattern: string): string {
  const segments = pattern.split('/');
  let expression = '';
  for (const [index, segment] of segments.entries()) {
    if (segment === '' && index > 0) continue;
    const separator =
      index === segments.length - 1 ? '[/\\\\]*?' : segments[index + 1] === '**' ? '' : '[/\\\\]+?';
    if (segment === '**') {
      if (separator) {
        expression += index === 0 ? '' : separator;
        expression += `(?:[^/\\\\]*?${separator})*?`;
      }
    } else expression += segmentExpression(segment) + separator;
  }
  return expression;
}
