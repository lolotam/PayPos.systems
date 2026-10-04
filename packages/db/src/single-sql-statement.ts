/** النصوص والتعليقات لا تعتبر فواصل SQL؛ أسماء الدولار تُطابق بنفس حالة الحروف. */
function quotedEnd(sql: string, start: number, quote: string): number {
  const escaped = quote === "'" && /(?:^|[^\w$])[eE]$/.test(sql.slice(0, start));
  for (let offset = start + 1; offset < sql.length; offset++) {
    if (escaped && sql[offset] === '\\') offset++;
    else if (sql[offset] === quote) {
      if (sql[offset + 1] === quote) offset++;
      else return offset + 1;
    }
  }
  return -1;
}

function blockCommentEnd(sql: string, start: number): number {
  let depth = 1;
  for (let offset = start + 2; offset < sql.length - 1; offset++) {
    if (sql.startsWith('/*', offset)) {
      depth++;
      offset++;
    } else if (sql.startsWith('*/', offset)) {
      depth--;
      offset++;
      if (depth === 0) return offset + 1;
    }
  }
  return -1;
}

/** يقبل statement واحداً فقط، حتى لو نص أو تعليق يحتوي على فاصلة منقوطة. */
export function isSingleSqlStatement(sql: string): boolean {
  let terminated = false;
  for (let offset = 0; offset < sql.length;) {
    if (/\s/.test(sql[offset] ?? '')) offset++;
    else if (sql.startsWith('--', offset)) {
      const end = sql.slice(offset + 2).search(/[\r\n]/);
      offset = end === -1 ? sql.length : offset + 2 + end + 1;
    } else if (sql.startsWith('/*', offset)) {
      offset = blockCommentEnd(sql, offset);
      if (offset === -1) return false;
    } else {
      if (terminated) return false;
      const char = sql[offset];
      if (char === ';') {
        terminated = true;
        offset++;
      } else if (char === "'" || char === '"') {
        offset = quotedEnd(sql, offset, char);
        if (offset === -1) return false;
      } else {
        const tag = /^\$(?:[a-z_\u0080-\uffff][a-z0-9_\u0080-\uffff]*)?\$/i.exec(
          sql.slice(offset),
        )?.[0];
        // الدولار داخل unquoted identifier ليس بداية نص dollar-quoted.
        if (tag && !/[\w$\u0080-\uffff]/.test(sql[offset - 1] ?? '')) {
          const end = sql.indexOf(tag, offset + tag.length);
          if (end === -1) return false;
          offset = end + tag.length;
        } else offset++;
      }
    }
  }
  return true;
}
