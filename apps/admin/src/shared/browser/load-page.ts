// A full page load, not a client-side push: the signed-in user changed, so every cached query and provider
// state from the previous user must go with the old page.
export function loadPage(path: string): void {
  globalThis.location.assign(path);
}
