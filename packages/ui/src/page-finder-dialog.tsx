'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useRef, type KeyboardEvent, type RefObject } from 'react';
import { Button } from './button.js';
import type { useDirection } from './direction-provider.js';
import { Input } from './input.js';
import type { FinderResult, NavigationFinderLabels } from './navigation-presentation.js';
import { isVisibleElement } from './page-finder-focus.js';
import { FinderResultList } from './page-finder-result-list.js';

type FinderDialogProps = {
  dir: ReturnType<typeof useDirection>;
  labels: NavigationFinderLabels;
  query: string;
  results: readonly FinderResult[];
  activePageId?: string | undefined;
  onQueryChange: (query: string) => void;
  onSelect: (result: FinderResult) => void;
  onCloseAutoFocus: (event: Event) => void;
};

function onFinderInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  listRef: RefObject<HTMLUListElement | null>,
) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
  const firstVisible = Array.from(
    listRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-finder-result]') ?? [],
  ).find(isVisibleElement);
  if (!firstVisible) return;
  event.preventDefault();
  firstVisible.click();
}

export function FinderDialog({
  dir,
  labels,
  query,
  results,
  activePageId,
  onQueryChange,
  onSelect,
  onCloseAutoFocus,
}: FinderDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <Dialog.Content
      dir={dir}
      aria-modal="true"
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        input.current?.focus();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      className="fixed inset-x-2 top-8 z-50 max-h-[min(80vh,36rem)] overflow-y-auto min-[600px]:mx-auto min-[600px]:max-w-lg rounded-card bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="mb-3 flex items-center gap-2">
        <Dialog.Title className="text-base font-semibold">{labels.title}</Dialog.Title>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" className="ms-auto" aria-label={labels.close}>
            <XIcon aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </div>
      <Input
        ref={input}
        type="search"
        value={query}
        aria-label={labels.search}
        placeholder={labels.search}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => onFinderInputKeyDown(event, listRef)}
      />
      <div className="mt-3">
        {results.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <FinderResultList
            results={results}
            labels={labels}
            activePageId={activePageId}
            listRef={listRef}
            onSelect={onSelect}
          />
        )}
      </div>
    </Dialog.Content>
  );
}
