/**
 * Stepping primitives for the run loop.
 *
 * This layer owns no scheduling: rAF, timers, or worker message loops are
 * the consumer's choice. It owns the semantics of one step — run the
 * budget, drain the console, recognise stops and stalls.
 */
import { ExitKind } from './abi'
import { GuestStoppedError } from './errors'
import { LoupeMachine } from './machine'

/** Result of one step. */
export interface FeedStep {
  /** Instructions retired in this step. */
  retired: number
  /** Cumulative retired count. */
  icount: number
  /** New serial console text. */
  text: string
  /** Set when the guest has stopped (exit kind name and code). */
  stopped: { kind: string; code: number; rip: number } | null
}

export interface FeedOptions {
  /** Per-step budget; 500k ≈ one full 16 ms frame. */
  budget?: number
  /**
   * Boot budget: still silent (no console output at all, not merely idle)
   * past this count, the boot counts as stalled.
   */
  bootBudget?: number
  /** Consecutive silent steps tolerated before a stall is declared. */
  stallSteps?: number
  /** Throw on engine errors instead of reporting them through `stopped`. */
  throwOnError?: boolean
}

/** One step: run the budget, drain the console, detect stops and stalls. */
export function stepFeed(
  machine: LoupeMachine,
  printed: number,
  stall: number,
  options: FeedOptions = {},
): { feed: FeedStep; printed: number; stall: number } {
  const budget = options.budget ?? 500_000
  const bootBudget = options.bootBudget ?? 400_000_000
  const stallLimit = options.stallSteps ?? 40
  const outcome = machine.run(budget)
  const drained = machine.readConsole(printed)
  const nextStall = drained.text === '' ? stall + 1 : 0
  if (outcome.kind !== ExitKind.Running) {
    return {
      feed: {
        retired: outcome.retired,
        icount: machine.icount,
        text: drained.text,
        stopped: {
          kind: LoupeMachine.exitName(outcome.kind),
          code: outcome.code,
          rip: machine.rip,
        },
      },
      printed: drained.printed,
      stall: nextStall,
    }
  }
  // A silent guest that has already spoken is idle (waiting for input),
  // not stalled; only a boot that never produced output dies here.
  if (
    drained.text === '' &&
    printed === 0 &&
    machine.icount > bootBudget &&
    nextStall > stallLimit
  ) {
    if (options.throwOnError !== false) {
      throw new GuestStoppedError('StallNoOutput', 0, machine.rip)
    }
    return {
      feed: {
        retired: outcome.retired,
        icount: machine.icount,
        text: '',
        stopped: { kind: 'StallNoOutput', code: 0, rip: machine.rip },
      },
      printed: drained.printed,
      stall: nextStall,
    }
  }
  return {
    feed: {
      retired: outcome.retired,
      icount: machine.icount,
      text: drained.text,
      stopped: null,
    },
    printed: drained.printed,
    stall: nextStall,
  }
}

/**
 * Run synchronously until the guest stops or a limit is hit (whole-batch
 * runs inside a worker). Console text from every step is concatenated.
 */
export function runUntil(
  machine: LoupeMachine,
  limits: {
    maxInstructions?: number
    maxSteps?: number
    budget?: number
  } = {},
): { text: string; icount: number; stopped: FeedStep['stopped'] } {
  const budget = limits.budget ?? 500_000
  const maxSteps = limits.maxSteps ?? 4_000
  let printed = 0
  let stall = 0
  let text = ''
  let steps = 0
  const target = machine.icount + (limits.maxInstructions ?? Infinity)
  for (;;) {
    const r = stepFeed(machine, printed, stall, { budget, throwOnError: false })
    printed = r.printed
    stall = r.stall
    text += r.feed.text
    steps += 1
    if (r.feed.stopped !== null) {
      return { text, icount: r.feed.icount, stopped: r.feed.stopped }
    }
    if (r.feed.icount >= target || steps >= maxSteps) {
      return { text, icount: r.feed.icount, stopped: null }
    }
  }
}
