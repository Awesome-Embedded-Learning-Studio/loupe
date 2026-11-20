// Browser-direct GitHub fetch for ONE repository's open issues. No build-time
// snapshot and no token: opening the page shows something recent. The strategy
// is lifted from the Awesome-Embedded site board, cut down to a single repo:
//
//   - the search endpoint returns every open issue in one request (anonymous
//     quota is 10 requests/min per IP, and everyone behind one egress IP
//     shares it, so failure paths must degrade gracefully);
//   - sub-issue totals ride along for free in sub_issues_summary, so the card
//     meter costs no extra request;
//   - a per-repository sessionStorage cache (5 minutes) keeps revisits and
//     twin boards on the same page off the quota.

const API = 'https://api.github.com'
const REPO_RE = /^[\w.-]+\/[\w.-]+$/

export interface IssueRecord {
  /** Globally unique key: lower-cased `owner/repo#number`. */
  key: string
  number: number
  title: string
  /** Parent issue key when GitHub reports one; folded under the parent card. */
  parentKey: string | null
  author: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
  labels: string[]
  url: string
  /** Sub-issue totals reported by the search response; 0 when absent. */
  childTotal: number
  completedChildren: number
  comments: number
}

/** Error carrying the HTTP status and the quota-reset instant, if known. */
export class GitHubError extends Error {
  status: number
  resetAt: number | null
  constructor(message: string, status: number, resetAt: number | null) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.resetAt = resetAt
  }
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof GitHubError && (error.status === 403 || error.status === 429)
}

async function ghFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) {
    const reset = res.headers.get('x-ratelimit-reset')
    throw new GitHubError(
      res.status === 403 || res.status === 429 ? 'rate limit' : `HTTP ${res.status}`,
      res.status,
      reset ? Number(reset) * 1000 : null,
    )
  }
  return res
}

function issueKey(repoFull: string, number: string | number): string {
  return `${repoFull.toLowerCase()}#${number}`
}

function parentKeyOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(url)
  return match ? issueKey(match[1], match[2]) : null
}

/** The slice of a GitHub search-issues item that normalize() reads. */
interface RawIssue {
  number: number
  title?: unknown
  html_url?: string
  parent_issue_url?: unknown
  user?: { login?: string | null; avatar_url?: string | null } | null
  created_at?: string
  updated_at?: string
  labels?: (string | { name?: unknown })[]
  comments?: number
  sub_issues_summary?: { total?: number; completed?: number }
}

/** The slice of the search response that fetchRepoIssues() reads. */
interface SearchResponse {
  total_count?: number
  items?: RawIssue[]
}

function normalize(raw: RawIssue, repoFull: string): IssueRecord {
  const summary: { total?: number; completed?: number } = raw.sub_issues_summary ?? {}
  return {
    key: issueKey(repoFull, raw.number),
    number: raw.number,
    title: String(raw.title ?? ''),
    parentKey: parentKeyOf(raw.parent_issue_url),
    author: raw.user?.login ?? null,
    avatarUrl: raw.user?.avatar_url ?? null,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? '',
    labels: (raw.labels ?? []).flatMap((label) => {
      if (typeof label === 'string') return [label]
      if (typeof label.name === 'string') return [label.name]
      return []
    }),
    url: raw.html_url ?? `https://github.com/${repoFull}/issues/${raw.number}`,
    childTotal: summary.total ?? 0,
    completedChildren: summary.completed ?? 0,
    comments: raw.comments ?? 0,
  }
}

/** One repository's open issues, newest update first, pull requests excluded. */
export async function fetchRepoIssues(repoFull: string): Promise<IssueRecord[]> {
  const scope = repoFull.trim()
  if (!REPO_RE.test(scope)) throw new Error('repo must be written as owner/name')
  const out = new Map<string, IssueRecord>()
  const q = encodeURIComponent(`repo:${scope} is:issue is:open`)
  for (let page = 1; page <= 10; page++) {
    const res = await ghFetch(`${API}/search/issues?q=${q}&per_page=100&page=${page}`)
    const data = (await res.json()) as SearchResponse
    const items: RawIssue[] = data.items ?? []
    for (const item of items) {
      const issue = normalize(item, scope)
      out.set(issue.key, issue)
    }
    if (items.length < 100 || out.size >= (data.total_count ?? Infinity)) break
  }
  return [...out.values()].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key),
  )
}

// ---- Session cache: 5 minutes, keyed per repository ----

const TTL = 5 * 60 * 1000

export interface IssuesPayload {
  repo: string
  items: IssueRecord[]
  /** Epoch ms of the fetch (or of the cache write it came from). */
  at: number
  cached: boolean
}

function cacheKey(repoFull: string): string {
  return `loupe-issues:v1:${repoFull.trim().toLowerCase()}`
}

/**
 * Loads one repository's open issues through the per-repo session cache.
 * `force` bypasses the cache (the refresh button); when sessionStorage is
 * unavailable every call goes to the network.
 */
export async function loadRepoIssues(repoFull: string, force = false): Promise<IssuesPayload> {
  const scope = repoFull.trim()
  if (!force) {
    try {
      const raw = sessionStorage.getItem(cacheKey(scope))
      if (raw) {
        const p = JSON.parse(raw) as { at: number; items: IssueRecord[] }
        if (p?.items?.length && Date.now() - p.at < TTL) {
          return { repo: scope, items: p.items, at: p.at, cached: true }
        }
      }
    } catch {
      // sessionStorage disabled or full: fall through to the network
    }
  }
  const items = await fetchRepoIssues(scope)
  const at = Date.now()
  try {
    sessionStorage.setItem(cacheKey(scope), JSON.stringify({ at, items }))
  } catch {
    // Cannot persist: the next visit simply fetches again
  }
  return { repo: scope, items, at, cached: false }
}
