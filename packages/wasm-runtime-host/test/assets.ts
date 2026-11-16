import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Local guest-asset discovery for integration tests.
 *
 * The engine's canonical source is a sibling micro-forge checkout;
 * demo/public/ acts as the distribution hub once scripts copy artifacts
 * there. Kernel and disk come from a sibling Cinux checkout. Every path
 * is overridable through environment variables (LOUPE_ENGINE_WASM,
 * LOUPE_CINUX_KERNEL, LOUPE_CINUX_DISK), and asset-dependent tests skip
 * themselves when nothing is found, so CI stays green without binaries.
 */

const repoRoot = join(import.meta.dirname, '../../..')

export const ENGINE_PATH = [
  process.env.LOUPE_ENGINE_WASM,
  join(repoRoot, 'demo/public/engine.wasm'),
  join(repoRoot, '..', 'micro-forge/build-wasm/engine.wasm'),
].filter((p): p is string => Boolean(p)).find(p => existsSync(p))

export const KERNEL_PATH = process.env.LOUPE_CINUX_KERNEL
  ?? join(repoRoot, '..', 'Cinux/build/kernel/kernel.bin')

export const DISK_PATH = process.env.LOUPE_CINUX_DISK
  ?? join(repoRoot, '..', 'Cinux/build/boot/ext2.img')
