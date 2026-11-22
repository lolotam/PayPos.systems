'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Button } from './button.js';
import { ContextPanelEmpty, ContextPanelSection } from './context-panel-section.js';
import { useDirection } from './direction-provider.js';
import { Input } from './input.js';
import {
  visiblePagesMatchingQuery,
  type ContextPanelLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';

export type ContextPanelBodyProps = {
  workspace?: NavigationWorkspace | undefined;
  labels: ContextPanelLabels;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onClose: () => void;
};

export function ContextPanelBody({
  workspace,
  labels,
  activePageId,
  visiblePageIds,
  onClose,
}: ContextPanelBodyProps) {
  const dir = useDirection();
  const [query, setQuery] = useState('');
  const sections = workspace?.sections ?? [];
  const hasVisiblePages = sections.some(
    (section) =>
      visiblePagesMatchingQuery(section.pages, visiblePageIds, query).length > 0,
  );
  return (
    <div dir={dir} className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex shrink-0 items-center gap-2 ps-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {workspace?.label ?? labels.empty}
        </h2>
        <Button variant="sidebar" size="icon" aria-label={labels.close} onClick={onClose}>
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <Input
        type="search"
        value={query}
        aria-label={labels.filterPages}
        placeholder={labels.filterPages}
        onChange={(event) => setQuery(event.currentTarget.value)}
        className="shrink-0"
      />
      {hasVisiblePages ? (
        sections.map((section) => (
          <ContextPanelSection
            key={section.id}
            section={section}
            query={query}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
          />
        ))
      ) : (
        <ContextPanelEmpty labels={labels} />
      )}
    </div>
  );
}
