/**
 * Streaming ANSI escape parser for the terminal console.
 *
 * The guest tty emits ANSI sequences interleaved with plain text. The
 * parser keeps a running SGR style, buffers partial sequences that straddle
 * feed chunks, and emits styled segments ready for the DOM. Only SGR
 * (colors/attributes) produces visible output; cursor-control and OSC
 * sequences are consumed silently, which is the right call for a serial
 * console whose real cursor handling is the guest tty itself.
 */

/** Resolved style of one segment; null fields mean "terminal default". */
export interface TermStyle {
  /** Foreground: 'p0'..'p15' palette key or any CSS color. */
  fg: string | null
  /** Background: same encoding as fg. */
  bg: string | null
  bold: boolean
  faint: boolean
  italic: boolean
  underline: boolean
}

/** One stretch of text sharing a single style. */
export interface TermSegment {
  text: string
  /** null means "terminal default style" (plain text node). */
  style: TermStyle | null
}

export const resetStyle = (): TermStyle => ({
  fg: null,
  bg: null,
  bold: false,
  faint: false,
  italic: false,
  underline: false,
})

const sameStyle = (a: TermStyle | null, b: TermStyle | null): boolean => {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.faint === b.faint
    && a.italic === b.italic && a.underline === b.underline
}

/** xterm 256-palette index to a CSS color (16 base colors stay palette keys). */
const palette256 = (index: number): string | null => {
  if (index < 16) return `p${index}`
  if (index < 232) {
    const cube = index - 16
    const level = (v: number): number => (v === 0 ? 0 : v * 40 + 55)
    return `rgb(${level((cube / 36) | 0)}, ${level(((cube / 6) | 0) % 6)}, ${level(cube % 6)})`
  }
  const gray = 8 + (index - 232) * 10
  return `rgb(${gray}, ${gray}, ${gray})`
}

export class AnsiStreamParser {
  private buf = ''
  private style: TermStyle

  constructor(initial?: TermStyle) {
    this.style = initial ?? resetStyle()
  }

  /** Style state after everything fed so far (pending bytes excluded). */
  get currentStyle(): TermStyle {
    return this.style
  }

  /**
   * Consumes text and returns styled segments. A trailing partial escape
   * sequence stays buffered until the next feed completes it.
   */
  feed(text: string): TermSegment[] {
    this.buf += text
    const segments: TermSegment[] = []
    let plain = 0 // start of the pending plain-text run in buf
    let i = 0
    while (i < this.buf.length) {
      if (this.buf[i] !== '\x1b') {
        i++
        continue
      }
      if (i > plain) this.emit(segments, this.buf.slice(plain, i))
      const taken = this.consumeEscape(i)
      if (taken === -1) {
        // Partial sequence: wait for more bytes; drop the plain text
        // before it from the buffer and stop here.
        this.buf = this.buf.slice(i)
        return segments
      }
      i += taken
      plain = i
    }
    if (plain < this.buf.length) this.emit(segments, this.buf.slice(plain))
    this.buf = ''
    return segments
  }

  /** Emits a plain-text run, merging with the previous segment's style. */
  private emit(segments: TermSegment[], text: string): void {
    if (text === '') return
    const style = sameStyle(this.style, resetStyle()) ? null : { ...this.style }
    const last = segments[segments.length - 1]
    if (last !== undefined && sameStyle(last.style, style)) last.text += text
    else segments.push({ text, style })
  }

  /**
   * Handles the escape sequence at `start`. Returns bytes consumed, or -1
   * when the sequence is incomplete so far.
   */
  private consumeEscape(start: number): number {
    const kind = this.buf[start + 1]
    if (kind === undefined) return -1
    if (kind === '[') {
      // CSI: params then a final byte in 0x40..0x7E.
      for (let j = start + 2; j < this.buf.length; j++) {
        const code = this.buf.charCodeAt(j)
        if (code < 0x20 || code > 0x3f) {
          if (code < 0x40 || code > 0x7e) {
            // Malformed CSI: drop the introducer only.
            return 2
          }
          if (this.buf[j] === 'm') this.applySgr(this.buf.slice(start + 2, j))
          return j - start + 1
        }
      }
      return -1
    }
    if (kind === ']') {
      // OSC: swallow through BEL or ST (ESC \).
      for (let j = start + 2; j < this.buf.length; j++) {
        if (this.buf[j] === '\x07') return j - start + 1
        if (this.buf[j] === '\x1b' && this.buf[j + 1] === '\\') return j - start + 2
      }
      return -1
    }
    // Two-byte escapes (ESC 7, ESC ( B, ...): consume and ignore.
    return 2
  }

  /** Applies one SGR parameter list to the running style. */
  private applySgr(paramsText: string): void {
    const params = paramsText === '' ? [0] : paramsText.split(';').map(Number)
    for (let k = 0; k < params.length; k++) {
      const p = Number.isNaN(params[k]) ? 0 : params[k]
      switch (p) {
        case 0: this.style = resetStyle(); break
        case 1: this.style.bold = true; break
        case 2: this.style.faint = true; break
        case 3: this.style.italic = true; break
        case 4: this.style.underline = true; break
        case 22: this.style.bold = false; this.style.faint = false; break
        case 23: this.style.italic = false; break
        case 24: this.style.underline = false; break
        case 39: this.style.fg = null; break
        case 49: this.style.bg = null; break
        default:
          if (p >= 30 && p <= 37) this.style.fg = `p${p - 30}`
          else if (p >= 90 && p <= 97) this.style.fg = `p${p - 90 + 8}`
          else if (p >= 40 && p <= 47) this.style.bg = `p${p - 40}`
          else if (p >= 100 && p <= 107) this.style.bg = `p${p - 100 + 8}`
          else if (p === 38 || p === 48) {
            const extended = this.extendedColor(params, k)
            if (extended === undefined) return // incomplete; stop at end of list
            if (p === 38) this.style.fg = extended.color
            else this.style.bg = extended.color
            k += extended.skip
          }
      }
    }
  }

  /**
   * Resolves 38/48;5;n and 38/48;2;r;g;b. Returns the color plus how many
   * parameter slots it consumed, or undefined when the list is truncated.
   */
  private extendedColor(params: number[], k: number): { color: string; skip: number } | undefined {
    const mode = params[k + 1]
    if (mode === 5) {
      const n = params[k + 2]
      if (n === undefined) return undefined
      return { color: palette256(n) ?? 'inherit', skip: 2 }
    }
    if (mode === 2) {
      const [r, g, b] = [params[k + 2], params[k + 3], params[k + 4]]
      if (r === undefined || g === undefined || b === undefined) return undefined
      return { color: `rgb(${r}, ${g}, ${b})`, skip: 5 }
    }
    return { color: 'inherit', skip: 0 }
  }
}
