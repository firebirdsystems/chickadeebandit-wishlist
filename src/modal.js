/**
 * The page's single modal slot.
 *
 * One element at a time: opening tears down whatever was there. That teardown
 * is the reason this is a module rather than two functions in the page — the
 * share modal once kept its target in state beside it, and the teardown that
 * runs at the START of every open cleared it while the share modal was being
 * built. Anything a modal needs belongs ON the modal (see `shareTargetOf`), and
 * the only way to test that is for the tests to drive this exact code rather
 * than a re-implementation of it.
 */

export function createModal({ onClick, onChange } = {}) {
  let el = null;

  function close() {
    el?.remove();
    el = null;
  }

  /**
   * @param html  markup for the modal body
   * @param kind  what this modal IS, e.g. "share" — read back by the code that
   *              re-renders it, so a late repaint cannot land in a modal that
   *              has since been replaced by a different one.
   * @param data  per-modal state, written to `dataset` as the element is built.
   *              It is an ARGUMENT rather than something the caller attaches
   *              afterwards, so there is no window in which the modal exists
   *              without the thing it needs to render.
   */
  function open(html, kind = "", data = {}) {
    close();
    el = document.createElement("div");
    el.className = "modal-backdrop";
    el.dataset.modal = kind;
    Object.assign(el.dataset, data);
    el.innerHTML = `<div class="modal">${html}</div>`;
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    if (onClick) el.addEventListener("click", onClick);
    if (onChange) el.addEventListener("change", onChange);
    document.body.appendChild(el);
    return el;
  }

  return { open, close, current: () => el };
}
