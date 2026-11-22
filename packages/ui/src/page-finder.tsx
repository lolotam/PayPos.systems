'use client';

import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import {
  collectFinderResults,
  type NavigationFinderLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';
import { FinderDialog } from './page-finder-dialog.js';
import {
  isRestorableFocusTarget,
  restoreFinderFocusOnClose,
  type FinderOpenOrigin,
} from './page-finder-focus.js';

export type PageFinderProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: NavigationFinderLabels;
  visiblePageIds?: readonly string[] | undefined;
  activePageId?: string | undefined;
  onNavigate?: (() => void) | undefined;
  /** يغيّره المستضيف عند كل انتقال ليُغلق الباحث ويُمحى بحثه دون إعادة بنائه؛ الغياب لا يغيّر شيئًا. */
  resetKey?: string | undefined;
};

function useFinderShortcut(open: boolean, close: () => void, begin: () => void) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // على لوحة مفاتيح عربية event.key بيرجع «ن» مش k، فبنقبل الزر الفعلي KeyK كمان.
      const isFinderKey = event.code === 'KeyK' || event.key.toLocaleLowerCase() === 'k';
      if (!(event.ctrlKey || event.metaKey) || !isFinderKey) return;
      event.preventDefault();
      if (event.repeat) return;
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

type FinderControllerInput = Pick<
  PageFinderProps,
  'workspaces' | 'visiblePageIds' | 'onNavigate' | 'resetKey'
> & {
  triggerRef: RefObject<HTMLButtonElement | null>;
};

function usePageFinderController({
  workspaces,
  visiblePageIds,
  onNavigate,
  resetKey,
  triggerRef,
}: FinderControllerInput) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    setOpen(false);
    setQuery('');
  }
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
  resetKey,
}: PageFinderProps) {
  const dir = useDirection();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controller = usePageFinderController({
    workspaces,
    visiblePageIds,
    onNavigate,
    resetKey,
    triggerRef,
  });
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
