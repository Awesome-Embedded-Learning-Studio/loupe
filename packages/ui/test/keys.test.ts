import { describe, expect, it } from 'vitest'
import { keyToBytes } from '../src/keys'

describe('keyToBytes', () => {
  it('maps printable keys to themselves', () => {
    expect(keyToBytes({ key: 'a' })).toEqual([0x61])
    expect(keyToBytes({ key: 'A' })).toEqual([0x41])
    expect(keyToBytes({ key: ' ' })).toEqual([0x20])
  })

  it('maps enter to CR and backspace to DEL', () => {
    expect(keyToBytes({ key: 'Enter' })).toEqual([0x0d])
    expect(keyToBytes({ key: 'Backspace' })).toEqual([0x7f])
  })

  it('maps arrow keys to ANSI sequences', () => {
    expect(keyToBytes({ key: 'ArrowUp' })).toEqual([0x1b, 0x5b, 0x41])
    expect(keyToBytes({ key: 'ArrowDown' })).toEqual([0x1b, 0x5b, 0x42])
    expect(keyToBytes({ key: 'ArrowRight' })).toEqual([0x1b, 0x5b, 0x43])
    expect(keyToBytes({ key: 'ArrowLeft' })).toEqual([0x1b, 0x5b, 0x44])
  })

  it('maps home, end, and delete', () => {
    expect(keyToBytes({ key: 'Home' })).toEqual([0x1b, 0x5b, 0x48])
    expect(keyToBytes({ key: 'End' })).toEqual([0x1b, 0x5b, 0x46])
    expect(keyToBytes({ key: 'Delete' })).toEqual([0x1b, 0x5b, 0x33, 0x7e])
  })

  it('maps ctrl combos to control bytes', () => {
    expect(keyToBytes({ key: 'c', ctrlKey: true })).toEqual([0x03])
    expect(keyToBytes({ key: 'u', ctrlKey: true })).toEqual([0x15])
    expect(keyToBytes({ key: 'd', ctrlKey: true })).toEqual([0x04])
  })

  it('leaves browser and unknown keys to the browser', () => {
    expect(keyToBytes({ key: 'F5' })).toBeNull()
    expect(keyToBytes({ key: 'a', metaKey: true })).toBeNull()
    expect(keyToBytes({ key: 'a', altKey: true })).toBeNull()
    expect(keyToBytes({ key: 'Dead' })).toBeNull()
  })
})
