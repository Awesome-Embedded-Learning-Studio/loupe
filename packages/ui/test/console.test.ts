import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TermConsole from '../src/TermConsole.vue'

const WINDOW = 131072
const PAGE = 32768

function mountConsole() {
  const onBytes = vi.fn()
  const onText = vi.fn()
  const wrapper = mount(TermConsole, {
    props: { onBytes, onText },
    attachTo: document.body,
  })
  const vm = wrapper.vm as unknown as { push: (text: string) => void }
  const term = () => wrapper.element.querySelector('.term') as HTMLElement
  return { wrapper, vm, term, onBytes, onText }
}

describe('TermConsole', () => {
  it('appends pushed text to the mounted tail', () => {
    const { wrapper, vm, term } = mountConsole()
    vm.push('hello ')
    vm.push('world')
    expect(term().textContent).toBe('hello world')
    wrapper.unmount()
  })

  it('trims the DOM window once history passes WINDOW + PAGE', () => {
    const { wrapper, vm, term } = mountConsole()
    const filler = 'x'.repeat(WINDOW + PAGE + 1)
    vm.push(filler)
    // The mounted window is exactly WINDOW bytes of the newest history.
    expect(term().textContent?.length).toBe(WINDOW)
    expect(term().textContent).toBe(filler.slice(filler.length - WINDOW))
    wrapper.unmount()
  })

  it('keeps pushing after trimming and slides the window', () => {
    const { wrapper, vm, term } = mountConsole()
    const first = 'a'.repeat(WINDOW + PAGE)
    vm.push(first)
    vm.push('fresh-output')
    expect(term().textContent?.endsWith('fresh-output')).toBe(true)
    expect(term().textContent?.length).toBe(WINDOW)
    wrapper.unmount()
  })

  it('renders SGR colors as inline styles on dynamic spans', () => {
    const { wrapper, vm, term } = mountConsole()
    vm.push('plain \x1b[1;34mblue-dir\x1b[0m tail')
    expect(term().textContent).toBe('plain blue-dir tail')
    const span = term().querySelector('span') as HTMLSpanElement
    // Dynamic spans carry no scoped-style attribute, so the color must be
    // resolved inline; scoped CSS classes alone would never match them.
    expect(span.style.color).toBe('#81a1c1')
    expect(span.style.fontWeight).toBe('bold')
    wrapper.unmount()
  })

  it('sends ANSI sequences for arrow keys and control bytes for combos', async () => {
    const { wrapper, onBytes } = mountConsole()
    const term = wrapper.find('.term')
    await term.trigger('keydown', { key: 'ArrowLeft' })
    expect(onBytes).toHaveBeenCalledWith([0x1b, 0x5b, 0x44])
    await term.trigger('keydown', { key: 'c', ctrlKey: true })
    expect(onBytes).toHaveBeenCalledWith([0x03])
    await term.trigger('keydown', { key: 'Enter' })
    expect(onBytes).toHaveBeenCalledWith([0x0d])
    wrapper.unmount()
  })

  it('leaves F5 and Ctrl+R to the browser', async () => {
    const { wrapper, onBytes } = mountConsole()
    const term = wrapper.find('.term')
    await term.trigger('keydown', { key: 'F5' })
    await term.trigger('keydown', { key: 'r', ctrlKey: true })
    expect(onBytes).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
