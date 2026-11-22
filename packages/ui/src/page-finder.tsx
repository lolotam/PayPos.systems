'use client';

import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import { Input } from './input.js';
import {
  collectFinderResults,
  type FinderResult,
  type NavigationFinderLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

export type PageFinderProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: NavigationFinderLabels;
  visiblePageIds?: readonly string[] | undefined;
  activePageId?: string | undefined;
  onNavigate?: (() => void) | undefined;
};

type FinderOpenOrigin = 'trigger' | 'shortcut';

type FinderResultListProps = {
  results: readonly FinderResult[];
  labels: NavigationFinderLabels;
  activePageId?: string | undefined;
  listRef: RefObject<HTMLUListElement | null>;
  onSelect: (result: FinderResult) => void;
};

function FinderResultList({ results, labels, activePageId, listRef, onSelect }: FinderResultListProps) {
  return (
    <ul ref={listRef} aria-label={labels.title} className="flex flex-col gap-1">
      {results.map((result) => (
        <li key={`${result.workspace.id}:${result.section.id}:${result.page.id}`}>
          <a
            href={result.page.href}
            data-finder-result=""
            aria-current={result.page.id === activePageId ? 'page' : undefined}
            onClick={() => onSelect(result)}
            className={cn(
              'flex min-h-11 flex-col gap-0.5 rounded-interactive px-3 py-2 text-sm',
              SIDEBAR_GHOST_CLASSES,
            )}
          >
            <span className="truncate font-medium">{result.page.label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {result.workspace.label} · {result.section.label}
              {result.page.id === activePageId ? ` · ${labels.current}` : ''}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

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

function isVisibleElement(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false;
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
  }
  return true;
}

function isRestorableFocusTarget(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element === document.body || element === document.documentElement) return false;
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  if (!isVisibleElement(element)) return false;
  return element.tabIndex >= 0 || element.hasAttribute('tabindex') || element.isContentEditable;
}

function restoreFinderFocusOnClose(
  event: Event,
  openedBy: FinderOpenOrigin | undefined,
  previous: HTMLElement | undefined,
  trigger: HTMLButtonElement | null,
) {
  let restored = false;
  if (openedBy === 'shortcut') {
    for (const candidate of [previous, trigger]) {
      if (!isRestorableFocusTarget(candidate)) continue;
      candidate.focus();
      if (document.activeElement !== candidate) continue;
      restored = true;
      break;
    }
  }
  if (restored) event.preventDefault();
}

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

function FinderDialog({
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
      className="fixed inset-x-2 top-8 z-50 max-h-[min(80vh,36rem)] overflow-y-auto rounded-card bg-card p-4 text-card-foreground shadow-lg"
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

function useFinderShortcut(open: boolean, close: () => void, begin: () => void) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'k') return;
      event.preventDefault();
      if (open) close();
      else begin();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close, begin]);
}

function useFinderFocusRestore(triggerRef: RefObject<HTMLButtonElement | null>) {
  const openedBy = useRef<FinderOpenOrigin | undefined>(undefined);
  const restoreFocus = useRef<HTMLElement | undefined>(undefined);
  const captureShortcutFocus = useCallback(() => {
    openedBy.current = 'shortcut';
    restoreFocus.current = isRestorableFocusTarget(document.activeElement)
      ? document.activeElement
      : (triggerRef.current ?? undefined);
  }, [triggerRef]);
  const markTriggerOpened = useCallback(() => {
    openedBy.current = 'trigger';
  }, []);
  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      restoreFinderFocusOnClose(event, openedBy.current, restoreFocus.current, triggerRef.current);
      restoreFocus.current = undefined;
      openedBy.current = undefined;
    },
    [triggerRef],
  );
  return { captureShortcutFocus, markTriggerOpened, onCloseAutoFocus };
}

type FinderControllerInput = Pick<PageFinderProps, 'workspaces' | 'visiblePageIds' | 'onNavigate'> & {
  triggerRef: RefObject<HTMLButtonElement | null>;
};

function usePageFinderController({
  workspaces,
  visiblePageIds,
  onNavigate,
  triggerRef,
}: FinderControllerInput) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { captureShortcutFocus, markTriggerOpened, onCloseAutoFocus } =
    useFinderFocusRestore(triggerRef);
  const results = useMemo(
    () => collectFinderResults(workspaces, visiblePageIds, query),
    [workspaces, visiblePageIds, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);
  const beginShortcut = useCallback(() => {
    captureShortcutFocus();
    setQuery('');
    setOpen(true);
  }, [captureShortcutFocus]);
  useFinderShortcut(open, close, beginShortcut);

  const select = useCallback(() => {
    onNavigate?.();
    close();
  }, [onNavigate, close]);
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) setOpen(true);
      else close();
    },
    [close],
  );

  return {
    open,
    query,
    results,
    markTriggerOpened,
    select,
    setQuery,
    onCloseAutoFocus,
    onOpenChange,
  };
}

export function PageFinder({
  workspaces,
  labels,
  visiblePageIds,
  activePageId,
  onNavigate,
}: PageFinderProps) {
  const dir = useDirection();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controller = usePageFinderController({ workspaces, visiblePageIds, onNavigate, triggerRef });
  return (
    <Dialog.Root open={controller.open} onOpenChange={controller.onOpenChange}>
      <Dialog.Trigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          aria-label={labels.trigger}
          onClick={controller.markTriggerOpened}
        >
          <MagnifyingGlassIcon aria-hidden="true" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <FinderDialog
          dir={dir}
          labels={labels}
          query={controller.query}
          results={controller.results}
          activePageId={activePageId}
          onQueryChange={controller.setQuery}
          onSelect={controller.select}
          onCloseAutoFocus={controller.onCloseAutoFocus}
        />
      </Dialog.Portal>
    </Dialog.Root>
  );
}
