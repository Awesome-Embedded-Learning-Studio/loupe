/**
 * Browser keyboard events to guest tty bytes.
 *
 * Printable keys map to themselves; control combos map to the matching
 * control byte; navigation keys map to the ANSI escape sequences a
 * terminal application expects. Keys the guest cannot use (browser
 * shortcuts, IME composition) map to null so the caller can leave them
 * to the browser.
 */

/** Keys longer than one character that still belong to the tty. */
const NAV_KEYS: Record<string, number[]> = {
  Enter: [0x0d],
  Backspace: [0x7f],
  Tab: [0x09],
  Escape: [0x1b],
  ArrowUp: [0x1b, 0x5b, 0x41],
  ArrowDown: [0x1b, 0x5b, 0x42],
  ArrowRight: [0x1b, 0x5b, 0x43],
  ArrowLeft: [0x1b, 0x5b, 0x44],
  Home: [0x1b, 0x5b, 0x48],
  End: [0x1b, 0x5b, 0x46],
  Insert: [0x1b, 0x5b, 0x32, 0x7e],
  Delete: [0x1b, 0x5b, 0x33, 0x7e],
  PageUp: [0x1b, 0x5b, 0x35, 0x7e],
  PageDown: [0x1b, 0x5b, 0x36, 0x7e],
}

/** Bytes for one keystroke, or null when the key is not the guest's business. */
export function keyToBytes(event: {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): number[] | null {
  if (event.metaKey === true || event.altKey === true) return null
  if (event.ctrlKey === true) {
    if (event.key.length !== 1) {
      // Ctrl+ArrowLeft etc. are xterm modifiers; the guest reads plain sequences.
      return NAV_KEYS[event.key] ?? null
    }
    const code = event.key.toUpperCase().charCodeAt(0)
    if (code >= 0x40 && code <= 0x5f) return [code & 0x1f]
    return null
  }
  if (event.key.length === 1) return [event.key.charCodeAt(0)]
  return NAV_KEYS[event.key] ?? null
}
