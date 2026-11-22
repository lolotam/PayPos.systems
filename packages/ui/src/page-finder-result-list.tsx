'use client';

import type { RefObject } from 'react';
import {
  onSameTabActivation,
  type FinderResult,
  type NavigationFinderLabels,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

type FinderResultListProps = {
  results: readonly FinderResult[];
  labels: NavigationFinderLabels;
  activePageId?: string | undefined;
  listRef: RefObject<HTMLUListElement | null>;
  onSelect: (result: FinderResult) => void;
};

export function FinderResultList({ results, labels, activePageId, listRef, onSelect }: FinderResultListProps) {
  return (
    <ul ref={listRef} aria-label={labels.title} className="flex flex-col gap-1">
      {results.map((result) => (
        <li key={`${result.workspace.id}:${result.section.id}:${result.page.id}`}>
          <a
            href={result.page.href}
            data-finder-result=""
            aria-current={result.page.id === activePageId ? 'page' : undefined}
            onClick={onSameTabActivation(() => onSelect(result))}
            className={cn(
              'flex min-h-11 flex-col gap-0.5 rounded-interactive px-3 py-2 text-sm',
              SIDEBAR_GHOST_CLASSES,
            )}
          >
            <span className="truncate font-medium">{result.page.label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {result.workspace.label} · {result.section.label}
              {result.page.status ? ` · ${result.page.status}` : ''}
              {result.page.id === activePageId ? ` · ${labels.current}` : ''}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
