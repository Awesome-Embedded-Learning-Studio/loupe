/**
 * Engine worker entry for the demo page. Binds the worker logic to this
 * dedicated worker's port; the page talks to it through `EngineClient`.
 * URL-loaded assets cache in OPFS.
 */
import { EngineWorkerLogic, bindEngineWorker } from '@aels/wasm-runtime-host/worker'
import { OpfsCacheBackend } from '@aels/wasm-runtime-host'

const logic = new EngineWorkerLogic(
  (event) => {
    self.postMessage(event)
  },
  { backend: new OpfsCacheBackend() },
)
bindEngineWorker(logic, self)
