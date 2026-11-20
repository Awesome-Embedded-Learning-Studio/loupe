import { describe, expect, it } from 'vitest'
import { AnsiStreamParser, resetStyle } from '../src/ansi'

describe('AnsiStreamParser', () => {
  it('passes plain text through untouched', () => {
    const parser = new AnsiStreamParser()
    expect(parser.feed('hello ls\r\n')).toEqual([{ text: 'hello ls\r\n', style: null }])
  })

  it('styles SGR runs and resets with 0', () => {
    const parser = new AnsiStreamParser()
    const segments = parser.feed('\x1b[1;34mbin\x1b[0m plain')
    expect(segments).toHaveLength(2)
    expect(segments[0].style).toMatchObject({ bold: true, fg: 'p4' })
    expect(segments[0].text).toBe('bin')
    expect(segments[1].style).toBeNull()
    expect(segments[1].text).toBe(' plain')
  })

  it('buffers a sequence split across feed chunks', () => {
    const parser = new AnsiStreamParser()
    expect(parser.feed('a\x1b[1;')).toEqual([{ text: 'a', style: null }])
    const segments = parser.feed('34mblue')
    expect(segments).toHaveLength(1)
    expect(segments[0].style).toMatchObject({ fg: 'p4' })
    expect(segments[0].text).toBe('blue')
    expect(parser.feed('!')).toEqual([
      {
        text: '!',
        style: { fg: 'p4', bg: null, bold: true, faint: false, italic: false, underline: false },
      },
    ])
  })

  it('keeps the style across chunks when no reset was seen', () => {
    const parser = new AnsiStreamParser()
    parser.feed('\x1b[32m')
    expect(parser.feed('more')).toEqual([
      {
        text: 'more',
        style: { fg: 'p2', bg: null, bold: false, faint: false, italic: false, underline: false },
      },
    ])
  })

  it('swallows non-SGR CSI and OSC sequences', () => {
    const parser = new AnsiStreamParser()
    const segments = parser.feed('\x1b[2J\x1b]0;title\x07ok\x1b[H\x1b[K!')
    expect(segments).toEqual([{ text: 'ok!', style: null }])
  })

  it('resolves 256-color and truecolor parameters', () => {
    const parser = new AnsiStreamParser()
    const [a] = parser.feed('\x1b[38;5;196mred\x1b[0m')
    expect(a.style?.fg).toBe('rgb(255, 0, 0)')
    const [b] = parser.feed('\x1b[38;2;10;20;30mx\x1b[0m')
    expect(b.style?.fg).toBe('rgb(10, 20, 30)')
  })

  it('maps bright colors to the high palette', () => {
    const parser = new AnsiStreamParser()
    const [seg] = parser.feed('\x1b[1;91mhot\x1b[0m')
    expect(seg.style).toMatchObject({ bold: true, fg: 'p9' })
  })

  it('exposes the running style for remount starts', () => {
    const probe = new AnsiStreamParser()
    probe.feed('plain\x1b[1;35m')
    const tail = new AnsiStreamParser(probe.currentStyle)
    const [seg] = tail.feed('tail')
    expect(seg.style).toMatchObject({ bold: true, fg: 'p5' })
  })

  it('consumes private CSI sequences and keeps later text', () => {
    const parser = new AnsiStreamParser()
    expect(parser.feed('\x1b[?')).toEqual([]) // incomplete, stays buffered
    expect(parser.feed('25h')).toEqual([]) // cursor-visibility CSI, swallowed
    const segments = parser.feed('y')
    expect(segments.map((s) => s.text).join('')).toBe('y')
  })

  it('starts from the given initial style', () => {
    const style = { ...resetStyle(), fg: 'p6' }
    const parser = new AnsiStreamParser(style)
    expect(parser.feed('t')).toEqual([{ text: 't', style: { ...style } }])
  })
})
