import { describe, expect, it } from 'vitest'
import { decodeEngineVersion, unpackExit, ExitKind } from '../src/abi'

describe('version packing', () => {
  it('decodes major/minor/patch', () => {
    expect(decodeEngineVersion(0x00020105)).toEqual({ major: 2, minor: 1, patch: 5 })
    expect(decodeEngineVersion(0)).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(decodeEngineVersion(0x00ffffff)).toEqual({ major: 255, minor: 255, patch: 255 })
  })
})

describe('exit unpacking', () => {
  it('splits kind and code', () => {
    expect(unpackExit(0x0000n)).toEqual({ kind: ExitKind.Running, code: 0 })
    // packed = code << 8 | kind: 0x300004 => code 0x3000, kind 4
    expect(unpackExit(0x300004n)).toEqual({ kind: ExitKind.DecodeError, code: 0x3000 })
    // 0x123402 => code 0x1234, kind 2
    expect(unpackExit(0x123402n)).toEqual({ kind: ExitKind.Exit, code: 0x1234 })
  })
})
