/**
 * @aels/loupe-ui
 *
 * Vue components for loupe pages: the terminal console, machine controls,
 * and the single-repository Issue board. Components receive a machine handle
 * from @aels/wasm-runtime-host and never touch the wasm ABI themselves
 * (IssueBoard touches no machine at all).
 */
export { default as TermConsole } from './TermConsole.vue'
export { default as LabShell } from './LabShell.vue'
export type { LabAsset, LabEngineClient, LabManifest, LabPreset } from './LabShell.vue'
export { default as IssueBoard } from './IssueBoard.vue'
export { fetchRepoIssues, GitHubError, isRateLimited, loadRepoIssues } from './issue-live'
export type { IssueRecord, IssuesPayload } from './issue-live'
export { keyToBytes } from './keys'
