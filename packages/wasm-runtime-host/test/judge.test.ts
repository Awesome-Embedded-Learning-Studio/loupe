import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { ExitKind, judgeSerial, loadEngine, LoupeMachine, matchesExpectation } from '../src/index'
import type { JudgeMachine } from '../src/index'
import { DISK_PATH, ENGINE_PATH, KERNEL_PATH } from './assets'

/** Scripted fake machine: typed input echoes back after a few runs. */
function fakeMachine(script: Record<string, string>): JudgeMachine & { runs: number } {
  const machine = {
    runs: 0,
    icount: 0,
    console: '',
    queued: '',
    readConsole(printed: number) {
      return { text: this.console.slice(printed), printed: this.console.length }
    },
    injectSerial(text: string, lineEnd = false) {
      const sent = `${text}${lineEnd ? '\r\n' : ''}`
      this.console += sent
      this.queued = text
    },
    run() {
      this.runs += 1
      this.icount += 100
      if (this.queued !== '' && this.runs >= 3) {
        this.console += `${script[this.queued] ?? ''}\r\n`
        this.queued = ''
      }
      return { kind: ExitKind.Running, code: 0, rip: 0 }
    },
  }
  return machine
}

describe('serial judging (pure logic on a fake machine)', () => {
  it('matches substring and regex expectations', () => {
    expect(matchesExpectation('hello judge-ok world', 'judge-ok')).toBe(true)
    expect(matchesExpectation('hello JUDGE-OK', /judge-ok/i)).toBe(true)
    expect(matchesExpectation('hello', 'missing')).toBe(false)
  })

  it('waits for the output of an injected command', async () => {
    const machine = fakeMachine({ 'echo hi': 'hi' })
    const result = await judgeSerial(
      machine,
      [{ input: 'echo hi', lineEnd: true, expect: 'hi', timeoutMs: 1_000 }],
      { stepGapMs: 1 },
    )
    expect(result.ok).toBe(true)
    expect(result.steps[0]?.outcome).toBe('matched')
  })

  it('times out and keeps judging the remaining steps', async () => {
    const machine = fakeMachine({})
    const result = await judgeSerial(
      machine,
      [
        { input: 'echo nope', expect: 'never-appears', timeoutMs: 60 },
        { input: 'echo hi', expect: 'echo hi', timeoutMs: 1_000 },
      ],
      { stepGapMs: 1 },
    )
    expect(result.ok).toBe(false)
    expect(result.steps[0]?.outcome).toBe('timeout')
    expect(result.steps[1]?.ok).toBe(true)
  })

  it('fails a step when the guest stops', async () => {
    const machine = fakeMachine({})
    let runs = 0
    machine.run = () => {
      runs += 1
      if (runs >= 2) return { kind: ExitKind.Fault, code: 14, rip: 0x1000 }
      return { kind: ExitKind.Running, code: 0, rip: 0 }
    }
    const result = await judgeSerial(machine, [{ expect: 'x', timeoutMs: 1_000 }], {
      stepGapMs: 1,
    })
    expect(result.ok).toBe(false)
    expect(result.steps[0]?.outcome).toBe('stopped:Fault')
  })
})

describe('serial judging (skipped without local engine and images)', () => {
  it.skipIf(!ENGINE_PATH || !existsSync(KERNEL_PATH) || !existsSync(DISK_PATH))(
    'judges a command echo on the real image',
    async () => {
      const bytes = await readFile(ENGINE_PATH!)
      const engine = await loadEngine({
        bytes: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      })
      const machine = LoupeMachine.default(engine)
      const kernel = new Uint8Array(await readFile(KERNEL_PATH))
      const disk = new Uint8Array(await readFile(DISK_PATH))
      machine.boot({ kernel, disk })

      // Boot to the shell banner, then judge a command echo.
      const boot = await judgeSerial(machine, [{ expect: 'Cinux up', timeoutMs: 120_000 }], {
        budget: 2_000_000,
        stepGapMs: 5,
      })
      expect(boot.ok).toBe(true)

      const judged = await judgeSerial(
        machine,
        [{ input: 'echo judge-integration-ok', lineEnd: true, expect: 'judge-integration-ok' }],
        { budget: 2_000_000, stepGapMs: 5 },
      )
      expect(judged.ok).toBe(true)
      expect(judged.steps[0]?.outcome).toBe('matched')
    },
    180_000,
  )
})
