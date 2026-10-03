'use client';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './button.js';

type Props = {
  value: string | null;
  copy?: { label: string; success: string; error: string };
};

export function Identifier({ value, copy }: Props) {
  const [notice, setNotice] = useState<string>();
  async function copyValue() {
    if (!value || !copy) return;
    try {
      await navigator.clipboard.writeText(value);
      setNotice(copy.success);
    } catch {
      setNotice(copy.error);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span
        dir="ltr"
        title={value ?? undefined}
        className="whitespace-nowrap font-mono text-xs text-muted-foreground"
      >
        {value ? `${value.slice(0, 8)}…` : null}
      </span>
      {copy && value ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label={copy.label}
          title={copy.label}
          onClick={() => void copyValue()}
        >
          <Copy aria-hidden="true" />
        </Button>
      ) : null}
      <span role="status" className="sr-only">
        {notice}
      </span>
    </span>
  );
}
