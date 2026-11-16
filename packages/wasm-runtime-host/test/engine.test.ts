import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { loadEngine, LoupeMachine, ExitKind, runUntil } from '../src/index'

// The engine artifact ships by URL and never enters the repo; resolve it
// from these paths when present and skip the whole group otherwise (CI
// runs the logic-only cases).
import { DISK_PATH, ENGINE_PATH, KERNEL_PATH } from './assets'

async function loadLocalEngine() {
  const bytes = await readFile(ENGINE_PATH!)
  return loadEngine({
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  })
}

describe('engine artifact (skipped without a local engine.wasm)', () => {
  it.skipIf(!ENGINE_PATH)('passes the ABI check and reports versions', async () => {
    const engine = await loadLocalEngine()
    expect(engine.mf_abi_version()).toBe(1)
    const machine = LoupeMachine.default(engine)
    const { major, minor, patch } = machine.engineVersion
    expect(major).toBeGreaterThanOrEqual(0)
    expect(minor).toBeGreaterThanOrEqual(0)
    expect(patch).toBeGreaterThanOrEqual(0)
    expect(machine.guestRamSize).toBeGreaterThan(0)
    expect(machine.snapshotFormatVersion).toBeGreaterThan(0)
  })

  it.skipIf(!ENGINE_PATH)('round-trips guest memory write and peek', async () => {
    const engine = await loadLocalEngine()
    const machine = LoupeMachine.default(engine)
    const marker = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const paddr = 0x0030_0000
    expect(machine.writeGuest(paddr, marker)).toBe(true)
    expect(machine.peek32(paddr)).toBe(0xefbeadde)
  })

  it.skipIf(!ENGINE_PATH)('runs a tiny loop within the budget', async () => {
    const engine = await loadLocalEngine()
    const machine = LoupeMachine.default(engine)
    // mov eax,42 ; jmp $ — a full budget leaves the cpu Running.
    const paddr = 0x0030_0000
    const program = new Uint8Array([0xb8, 0x2a, 0x00, 0x00, 0x00, 0xeb, 0xfd])
    expect(machine.writeGuest(paddr, program)).toBe(true)
    engine.mf_reset(paddr, paddr + 0x1000)
    const outcome = machine.run(1000)
    expect(outcome.kind).toBe(ExitKind.Running)
    expect(outcome.retired).toBe(1000)
    expect(machine.icount).toBe(1000)
  })

  it.skipIf(!ENGINE_PATH)(
    'isolates cpu state per instance (the default window shares RAM by design)',
    async () => {
      const engine = await loadLocalEngine()
      const first = LoupeMachine.create(engine)
      const second = LoupeMachine.create(engine)
      // Instances with window=0 share the artifact's default guest window:
      // memory visibility across them is engine behaviour, not a bug; cpu
      // state (counters, registers) is per-instance.
      const marker = new Uint8Array([0x11, 0x22, 0x33, 0x44])
      const paddr = 0x0030_0000
      expect(first.writeGuest(paddr, marker)).toBe(true)
      expect(second.peek32(paddr)).toBe(0x44332211)
      const firstIcount = first.icount
      const step = second.run(1000)
      expect(step.retired).toBe(1000)
      expect(first.icount).toBe(firstIcount)
      first.destroy()
      second.destroy()
    },
  )
})

describe('cinux boot (skipped without local images)', () => {
  it.skipIf(!ENGINE_PATH || !existsSync(KERNEL_PATH) || !existsSync(DISK_PATH))(
    'boots to the shell banner and answers a command',
    async () => {
      const engine = await loadLocalEngine()
      const machine = LoupeMachine.default(engine)
      const kernel = new Uint8Array(await readFile(KERNEL_PATH))
      const disk = new Uint8Array(await readFile(DISK_PATH))
      machine.boot({ kernel, disk })

      const boot = runUntil(machine, { maxInstructions: 400_000_000 })
      expect(boot.stopped).toBeNull()
      expect(boot.text).toContain('Cinux up')

      // The arithmetic answer can only appear as real command output: the
      // injected line itself never contains "42", so a tty-echo-only shell
      // fails this assertion.
      machine.injectSerial('echo $((6*7))', true)
      const reply = runUntil(machine, { maxInstructions: 60_000_000 })
      expect(reply.text).toContain('42')
    },
    240_000,
  )
})
