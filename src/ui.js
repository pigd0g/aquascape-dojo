// Tiny DOM helpers shared by the top-bar wiring.

/** Copy text to the clipboard, falling back to a hidden textarea when the
 *  async Clipboard API is unavailable (http origins, older browsers).
 *  Returns whether the copy succeeded. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the execCommand path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Briefly swap a button's label for a confirmation, then restore it. */
export function flashButton(button, text, ms = 1500) {
  if (!button) return;
  clearTimeout(button._flashTimer);
  if (button.dataset.label == null) button.dataset.label = button.innerHTML;
  button.innerHTML = text;
  button._flashTimer = setTimeout(() => {
    button.innerHTML = button.dataset.label;
  }, ms);
}
