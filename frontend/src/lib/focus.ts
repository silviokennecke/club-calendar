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

/**
 * Moves focus to the first invalid field of a form (`aria-invalid="true"`) after a failed submit.
 * Field errors are not live regions: without the focus move a screen reader would not hear an error
 * the server reported (e.g. a wrong current password), focus would stay on the submit button.
 */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
