/**
 * Serial-output judging for tutorial exercises.
 *
 * A case is a list of steps: inject optional input, then wait until the
 * serial console matches the expectation (string substring or RegExp).
 * Results are data, not exceptions: a failed or timed-out step marks the
 * case `ok: false` and judging continues with the next step so the report
 * shows every failure at once.
 */
import { ExitKind } from './abi'

/** One judging step: optional input, then an expected console match. */
export interface JudgeStep {
  /** Text injected before waiting (typed on the serial line). */
  input?: string
  /** Append a CR after the input (commands need it). */
  lineEnd?: boolean
  /** Console substring or pattern the step waits for. */
  expect: string | RegExp
  /** Per-step wall-clock budget; default 15 s. */
  timeoutMs?: number
}

/** What judging needs from a machine; LoupeMachine satisfies it. */
export interface JudgeMachine {
  run(budget: number | bigint): { kind: ExitKind }
  readConsole(printed: number): { text: string; printed: number }
  injectSerial(text: string, lineEnd?: boolean): void
  readonly icount: number
}

export interface JudgeOptions {
  /** Instructions per polling run; default 2M (a few frames of work). */
  budget?: number
  /** Gap between polling runs in ms; default 10. */
  stepGapMs?: number
  /** Sleep implementation; injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Streams console text as it is read (live output). */
  onText?: (text: string) => void
}

/** Outcome of one step. */
export interface StepResult {
  input: string | null
  expect: string
  ok: boolean
  /** 'matched' | 'timeout' | 'stopped:<kind>' */
  outcome: string
  elapsedMs: number
  /** Console text seen during this step (diagnostics). */
  seen: string
}

/** Outcome of a whole case. */
export interface CaseResult {
  ok: boolean
  steps: StepResult[]
  icount: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/** Does `text` satisfy an expectation (substring or RegExp)? */
export function matchesExpectation(text: string, expect: string | RegExp): boolean {
  if (typeof expect === 'string') return text.includes(expect)
  return expect.test(text)
}

/** Run a case to completion; never throws for a failing step. */
export async function judgeSerial(
  machine: JudgeMachine,
  steps: JudgeStep[],
  options: JudgeOptions = {},
): Promise<CaseResult> {
  const budget = options.budget ?? 2_000_000
  const gap = options.stepGapMs ?? 10
  const sleep = options.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const results: StepResult[] = []
  let printed = machine.readConsole(0).printed

  for (const step of steps) {
    if (step.input !== undefined) {
      machine.injectSerial(step.input, step.lineEnd === true)
    }
    const deadline = Date.now() + (step.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const startedAt = Date.now()
    let seen = ''
    let outcome = 'timeout'
    while (Date.now() <= deadline) {
      const status = machine.run(budget)
      const drained = machine.readConsole(printed)
      printed = drained.printed
      seen += drained.text
      if (drained.text !== '') options.onText?.(drained.text)
      if (matchesExpectation(seen, step.expect)) {
        outcome = 'matched'
        break
      }
      if (status.kind !== ExitKind.Running) {
        outcome = `stopped:${ExitKind[status.kind] ?? status.kind}`
        break
      }
      await sleep(gap)
    }
    results.push({
      input: step.input ?? null,
      expect: String(step.expect),
      ok: outcome === 'matched',
      outcome,
      elapsedMs: Date.now() - startedAt,
      seen,
    })
  }
  return {
    ok: results.every(r => r.ok),
    steps: results,
    icount: machine.icount,
  }
}
