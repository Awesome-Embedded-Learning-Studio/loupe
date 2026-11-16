<script setup lang="ts">
import { ref } from 'vue'
import { AnsiStreamParser, type TermSegment, type TermStyle } from './ansi'
import { keyToBytes } from './keys'

/**
 * Terminal console with lazy history.
 *
 * All output lives in a JS string (cheap and never discarded); the DOM
 * mounts only the newest WINDOW bytes. Scrolling to the top prepends one
 * more page of history, so a long session cannot grow the DOM unboundedly.
 * While the user is scrolled up, fresh output goes to a backlog badge and
 * is flushed when they come back down. ANSI escapes are parsed on the way
 * into the DOM, so guest colors survive window remounts and page prepends:
 * the history string stays raw and every DOM path re-derives its styles.
 */
const props = defineProps<{
  /** Called for each keystroke, already mapped to guest bytes. */
  onBytes: (bytes: number[]) => void
  /** Called for pasted text. */
  onText: (text: string) => void
}>()

const PAGE = 32768 // history bytes prepended per top-edge load
const TOP_EDGE = 64 // scrollTop within this many px triggers a load
const WINDOW = 131072 // bytes kept mounted in the DOM

const body = ref<HTMLDivElement | null>(null)
const older = ref(0) // history bytes not yet mounted
const backlog = ref(0) // fresh bytes held back while scrolled up

let history = ''
let domStart = 0 // history index of the first mounted byte
let pinned = true
let parser = new AnsiStreamParser()

/**
 * ANSI 16-color palette tuned for the dark panel. Resolved inline at node
 * build time: dynamic spans carry no scoped-style data attribute, so
 * scoped CSS classes would never match them.
 */
const TERM_PALETTE = [
  '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b',
  '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
  '#4c566a', '#d08770', '#b5d6a7', '#f2df9e',
  '#a7c4e0', '#cba8cf', '#a5d6e5', '#ffffff',
] as const

/** Builds DOM nodes for styled segments (plain text stays a text node). */
const segmentNodes = (segments: TermSegment[]): Node[] =>
  segments.map(segment => {
    if (segment.style === null) return document.createTextNode(segment.text)
    const span = document.createElement('span')
    span.textContent = segment.text
    const { fg, bg, bold, faint, italic, underline } = segment.style
    if (fg !== null) span.style.color = paletteColor(fg)
    if (bg !== null) span.style.backgroundColor = paletteColor(bg)
    if (bold) span.style.fontWeight = 'bold'
    if (faint) span.style.opacity = '0.6'
    if (italic) span.style.fontStyle = 'italic'
    if (underline) span.style.textDecoration = 'underline'
    return span
  })

/** Maps a parser color ('pN' palette key or any CSS color) to a CSS value. */
const paletteColor = (color: string): string =>
  color.startsWith('p')
    ? TERM_PALETTE[Number(color.slice(1))] ?? 'inherit'
    : color

/** Appends parsed segments to the DOM and keeps the viewport pinned. */
const appendSegments = (segments: TermSegment[]): void => {
  const el = body.value
  if (el === null || segments.length === 0) return
  el.append(...segmentNodes(segments))
  if (history.length - domStart > WINDOW + PAGE) {
    // Unmount the oldest pages; the history string keeps everything.
    domStart = history.length - WINDOW
    mountTail()
    return
  }
  el.scrollTop = el.scrollHeight
}

/** Style state at a history position (for remount/prepend starts). */
const styleAt = (index: number): TermStyle => {
  const scan = new AnsiStreamParser()
  scan.feed(history.slice(0, index))
  return scan.currentStyle
}

/** Remounts the tail window; used when domStart moves a long way. */
const mountTail = (): void => {
  const el = body.value
  if (el === null) return
  parser = new AnsiStreamParser(styleAt(domStart))
  el.replaceChildren(...segmentNodes(parser.feed(history.slice(domStart))))
  if (pinned) el.scrollTop = el.scrollHeight
}

/** Append streamed console output. */
const push = (text: string): void => {
  if (text === '') return
  history += text
  if (!pinned) {
    // Fed later by flushBacklog, keeping parser state in sync.
    backlog.value += text.length
    return
  }
  appendSegments(parser.feed(text))
}

const flushBacklog = (): void => {
  if (backlog.value === 0) return
  const held = history.slice(history.length - backlog.value)
  backlog.value = 0
  appendSegments(parser.feed(held))
}

const jumpToLatest = (): void => {
  pinned = true
  backlog.value = 0
  if (history.length - domStart > WINDOW) {
    domStart = history.length - WINDOW
    mountTail()
    return
  }
  flushBacklog()
}

const onScroll = (): void => {
  const el = body.value
  if (el === null) return
  const wasPinned = pinned
  pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
  if (pinned && !wasPinned) {
    flushBacklog()
    return
  }
  if (el.scrollTop <= TOP_EDGE && domStart > 0) {
    const from = Math.max(0, domStart - PAGE)
    const page = history.slice(from, domStart)
    domStart = from
    older.value = domStart
    const pageParser = new AnsiStreamParser(styleAt(from))
    const fragment = document.createDocumentFragment()
    fragment.append(...segmentNodes(pageParser.feed(page)))
    const before = el.scrollHeight
    el.insertBefore(fragment, el.firstChild)
    el.scrollTop += el.scrollHeight - before // keep the viewport steady
  }
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) return
  const bytes = keyToBytes(event)
  if (bytes === null) return
  event.preventDefault()
  props.onBytes(bytes)
}

const onPaste = (event: ClipboardEvent): void => {
  const text = event.clipboardData?.getData('text')
  if (text === undefined || text === '') return
  event.preventDefault()
  props.onText(text)
}

/** Focus the terminal body so typing goes to the guest without clicking. */
const focus = (): void => {
  body.value?.focus()
}

defineExpose({ push, focus })
</script>

<template>
  <div class="term-wrap">
    <span v-if="older > 0" class="term-older">↑ 上滚加载更早输出（还有 {{ older }} 字节）</span>
    <div
      ref="body"
      class="term"
      tabindex="0"
      title="点击终端后直接打字，与真实串口一致"
      @scroll="onScroll"
      @keydown="onKeydown"
      @paste="onPaste"
    ></div>
    <button v-if="backlog > 0" class="term-jump" @click="jumpToLatest">
      ↓ {{ backlog }} 字节新输出
    </button>
  </div>
</template>

<style scoped>
.term-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  margin: 12px 18px;
}

.term {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  background: var(--loupe-panel, #101418);
  border: 1px solid var(--loupe-line, #2a3138);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.35;
  font-size: 13px;
  color: var(--loupe-fg, #cfe3d0);
  cursor: text;
  outline: none;
}

.term:focus {
  border-color: var(--loupe-accent, #8fd3ff);
  box-shadow: 0 0 0 2px var(--loupe-focus, rgba(143, 211, 255, 0.25));
}

.term-older {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  font-size: 11px;
  color: var(--loupe-dim, #7d8a94);
  background: var(--loupe-bg, #0b0e12);
  border: 1px solid var(--loupe-line, #2a3138);
  border-radius: 10px;
  padding: 2px 10px;
  pointer-events: none;
}

.term-jump {
  position: absolute;
  bottom: 14px;
  right: 18px;
  z-index: 2;
  font-size: 12px;
  padding: 5px 12px;
  border: 1px solid #2f6f8f;
  border-radius: 14px;
  background: #12303f;
  color: #bfe7ff;
  cursor: pointer;
}
</style>
