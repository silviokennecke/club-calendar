/**
 * Moves focus to the element with the given id (a heading with `tabIndex={-1}`) once the confirm
 * dialog has closed. Used after a delete or move, when the button that opened the dialog is gone and
 * focus would otherwise fall back to the page start. Does nothing when focus is already somewhere
 * (the user went on), so it never takes focus away from a field being typed in.
 */
export function focusAfterDialog(id: string) {
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById(id)?.focus({ preventScroll: true });
  }, 120);
}
