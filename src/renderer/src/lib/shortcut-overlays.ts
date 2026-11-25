// @env browser
const POPUP_SELECTOR = ':is([role="dialog"], [role="alertdialog"], [role="menu"])';

export function popupOwnsShortcut(event: KeyboardEvent): boolean {
  // A popup can close before the keydown bubbles to the application listener.
  return (
    event.composedPath().some((node) => node instanceof Element && node.matches(POPUP_SELECTOR)) ||
    document.querySelector(POPUP_SELECTOR + "[data-open]") !== null
  );
}
