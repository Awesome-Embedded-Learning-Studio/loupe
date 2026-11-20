import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LabShell from '../src/LabShell.vue'
import type { LabEngineClient } from '../src/LabShell.vue'

// import.meta.env.BASE_URL is '/' under vitest, so absolute() yields a
// full origin-qualified URL; build expectations the same way.
const abs = (src: string): string => new URL(`/${src}`, window.location.origin).href

const MANIFEST = {
  engine: { url: 'lab/engine.wasm', bytes: 1000, md5: 'e' },
  presets: [
    {
      id: 'shell',
      label: 'Shell 盘',
      kernel: { url: 'lab/k.bin', bytes: 10, md5: 'k' },
      disk: { url: 'lab/d.img', bytes: 20, md5: 'd' },
    },
    {
      id: 'lite',
      label: 'Lite 盘',
      kernel: { url: 'lab/k2.bin', bytes: 10, md5: 'k2' },
      disk: { url: 'lab/d2.img', bytes: 20, md5: 'd2' },
    },
  ],
}

function fakeClient() {
  const client: LabEngineClient & { calls: string[] } = {
    calls: [],
    load: vi.fn(async (url) => {
      client.calls.push(`load:${url}`)
      return { engine: { major: 1, minor: 2, patch: 3 } }
    }),
    bootUrls: vi.fn(async (kernelUrl, diskUrl) => {
      client.calls.push(`boot:${kernelUrl}|${diskUrl}`)
    }),
    inject: vi.fn(async (text) => {
      client.calls.push(`inject:${text}`)
    }),
    pause: vi.fn(async () => {
      client.calls.push('pause')
    }),
    run: vi.fn(async () => {
      client.calls.push('run')
    }),
    terminate: vi.fn(() => {
      client.calls.push('terminate')
    }),
  }
  return client
}

function mountShell(props: Record<string, unknown> = {}) {
  const created: Array<LabEngineClient & { calls: string[] }> = []
  const clients = [fakeClient(), fakeClient()]
  const createWorker = vi.fn(() => ({}) as unknown as Worker)
  const wrapper = mount(LabShell, {
    props: {
      manifest: 'lab/lab-assets.json',
      createWorker,
      createClient: vi.fn((worker: Worker) => {
        expect(worker).toBeDefined()
        const client = clients[created.length] ?? fakeClient()
        created.push(client)
        return client
      }),
      ...props,
    },
    attachTo: document.body,
  })
  return { wrapper, created, clients, createWorker }
}

describe('LabShell', () => {
  it('loads the manifest against the site base and offers presets', async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => MANIFEST }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = mountShell()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/lab/lab-assets.json', window.location.origin).href,
    )
    const options = wrapper.findAll('option')
    expect(options).toHaveLength(2)
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('shell')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('boots the selected preset through the injected client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => MANIFEST }) as unknown as Response),
    )
    const { wrapper, created } = mountShell()
    await flushPromises()
    await wrapper.find('button.primary').trigger('click')
    await flushPromises()
    expect(created).toHaveLength(1)
    expect(created[0].calls).toEqual([
      `load:${abs('lab/engine.wasm')}`,
      `boot:${abs('lab/k.bin')}|${abs('lab/d.img')}`,
      'run',
    ])
    expect(wrapper.text()).toContain('运行中')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('switching presets restarts the guest with the new pair', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => MANIFEST }) as unknown as Response),
    )
    const { wrapper, created } = mountShell({ preset: 'shell' })
    await flushPromises()
    await wrapper.find('button.primary').trigger('click')
    await flushPromises()
    const select = wrapper.find('select')
    await select.setValue('lite')
    await flushPromises()
    expect(created).toHaveLength(2)
    expect(created[0].calls).toContain('terminate')
    expect(created[1].calls).toEqual([
      `load:${abs('lab/engine.wasm')}`,
      `boot:${abs('lab/k2.bin')}|${abs('lab/d2.img')}`,
      'run',
    ])
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('surfaces manifest failures without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      }),
    )
    const { wrapper } = mountShell()
    await flushPromises()
    expect(wrapper.text()).toContain('镜像清单加载失败')
    expect(wrapper.text()).toContain('boom')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
