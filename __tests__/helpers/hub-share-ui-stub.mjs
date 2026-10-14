/**
 * Stand-in for the hub's /hub-share-ui.js, which the page imports by absolute
 * URL. The boot test only needs the page to evaluate; the panel's behaviour is
 * tested in hub-contract, and the wish-list half in share-ui.test.mjs.
 */
export function createShareUi() {
  return { open() {}, close() {}, create() {}, copy() {}, revoke() {}, handleClick() {}, handleChange() {}, isOpen: () => false };
}
export function createOverlayView() {
  return { bind() {}, show() {}, render() {}, hide() {} };
}
