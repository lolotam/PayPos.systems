export type FinderOpenOrigin = 'trigger' | 'shortcut';

export function isVisibleElement(element: HTMLElement): boolean {
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

export function isRestorableFocusTarget(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element === document.body || element === document.documentElement) return false;
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  if (!isVisibleElement(element)) return false;
  return element.tabIndex >= 0 || element.hasAttribute('tabindex') || element.isContentEditable;
}

export function restoreFinderFocusOnClose(
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
