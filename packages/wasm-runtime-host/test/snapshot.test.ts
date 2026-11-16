import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  encodeSnapshot,
  parseSnapshot,
  snapshotMismatch,
  SnapshotFormatError,
  SnapshotMismatchError,
  SNAPSHOT_ENGINE_NAME,
  loadEngine,
  LoupeMachine,
  ExitKind,
} from '../src/index'
import { ENGINE_PATH } from './assets'

const header = {
  engine: SNAPSHOT_ENGINE_NAME,
  engineVersion: '1.2.3',
  snapshotFormat: 7,
  ramSize: 0x1000_0000,
  savedAt: '2026-11-16T00:00:00.000Z',
}

describe('snapshot container (pure logic)', () => {
  it('round-trips header and blob', () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5])
    const packed = encodeSnapshot(header, blob)
    const parsed = parseSnapshot(packed)
    expect(parsed.header).toEqual(header)
    expect([...parsed.blob]).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects foreign bytes and truncation', () => {
    expect(() => parseSnapshot(new Uint8Array(64))).toThrow(SnapshotFormatError)
    const packed = encodeSnapshot(header, new Uint8Array([9]))
    expect(() => parseSnapshot(packed.slice(0, 10))).toThrow(SnapshotFormatError)
  })

  it('reports the first failing field of the version triple', () => {
    expect(snapshotMismatch(header, { engine: SNAPSHOT_ENGINE_NAME, engineVersion: '1.2.3', snapshotFormat: 7 })).toBeNull()
    expect(
      snapshotMismatch(header, { engine: 'other', engineVersion: '1.2.3', snapshotFormat: 7 }),
    ).toContain('vs other')
    expect(
      snapshotMismatch(header, { engine: SNAPSHOT_ENGINE_NAME, engineVersion: '9.9.9', snapshotFormat: 7 }),
    ).toContain('engineVersion')
    expect(
      snapshotMismatch(header, { engine: SNAPSHOT_ENGINE_NAME, engineVersion: '1.2.3', snapshotFormat: 8 }),
    ).toContain('snapshotFormat')
  })
})

describe('machine snapshots (skipped without a local engine.wasm)', () => {
  it.skipIf(!ENGINE_PATH)(
    'saves, keeps running, restores the cpu state, and keeps running again',
    async () => {
      const bytes = await readFile(ENGINE_PATH!)
      const engine = await loadEngine({
        bytes: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      })
      const machine = LoupeMachine.default(engine)
      // mov eax,42 ; jmp $ at a fixed guest address.
      const paddr = 0x0030_0000
      machine.writeGuest(paddr, new Uint8Array([0xb8, 0x2a, 0x00, 0x00, 0x00, 0xeb, 0xfd]))
      machine.reset(paddr, paddr + 0x1000)
      machine.run(1000)
      const ripAtSave = machine.rip

      const snap = machine.snapshot()
      const parsed = parseSnapshot(snap)
      expect(parsed.header.engine).toBe(SNAPSHOT_ENGINE_NAME)
      expect(parsed.header.snapshotFormat).toBe(machine.snapshotFormatVersion)
      expect(parsed.blob.length).toBeGreaterThan(machine.guestRamSize)

      machine.run(5000)
      expect(machine.rip).not.toBe(ripAtSave)

      machine.restore(snap)
      expect(machine.rip).toBe(ripAtSave)
      // icount is not part of the snapshot; it restarts from zero.
      const outcome = machine.run(1000)
      expect(outcome.kind).toBe(ExitKind.Running)
      expect(machine.icount).toBeGreaterThanOrEqual(1000)
    },
  )

  it.skipIf(!ENGINE_PATH)('refuses a snapshot from another engine version', async () => {
    const bytes = await readFile(ENGINE_PATH!)
    const engine = await loadEngine({
      bytes: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    })
    const machine = LoupeMachine.default(engine)
    const { header, blob } = parseSnapshot(machine.snapshot())
    const forged = encodeSnapshot({ ...header, engineVersion: '999.0.0' }, blob)
    expect(() => machine.restore(forged)).toThrow(SnapshotMismatchError)
  })
})
