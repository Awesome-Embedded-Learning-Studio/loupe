import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRepoIssues, GitHubError, isRateLimited, loadRepoIssues } from '../src/issue-live'


// The network layer is stubbed with minimal Response shapes: ghFetch reads
// only ok / status / headers / json.
function searchResponse(items: object[], extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ total_count: items.length, items, ...extra }),
  }
}

function rawIssue(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/acme/widget/issues/${number}`,
    user: { login: 'alice', avatar_url: 'https://avatars.example/alice.png' },
    created_at: '2026-11-01T00:00:00Z',
    updated_at: `2026-11-${String(number).padStart(2, '0')}T00:00:00Z`,
    labels: [{ name: 'bug' }],
    comments: 2,
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  sessionStorage.clear()
})

describe('fetchRepoIssues', () => {
  it('queries the search endpoint scoped to the repository and normalizes', async () => {
    fetchMock.mockResolvedValue(searchResponse([
      rawIssue(2, { labels: ['feat', 'help wanted'] }),
      rawIssue(1, { parent_issue_url: 'https://api.github.com/repos/acme/widget/issues/3' }),
    ]))
    const items = await fetchRepoIssues('acme/widget')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/search/issues')
    expect(url.searchParams.get('q')).toBe('repo:acme/widget is:issue is:open')
    expect(url.searchParams.get('per_page')).toBe('100')

    // Newest update first; keys are lower-cased repo#number.
    expect(items.map((i) => i.number)).toEqual([2, 1])
    expect(items[0]).toMatchObject({
      key: 'acme/widget#2',
      author: 'alice',
      avatarUrl: 'https://avatars.example/alice.png',
      labels: ['feat', 'help wanted'],
      comments: 2,
      childTotal: 0,
      completedChildren: 0,
      parentKey: null,
    })
    expect(items[1].parentKey).toBe('acme/widget#3')
  })

  it('keeps paginating while pages come back full', async () => {
    const first = Array.from({ length: 100 }, (_, n) => rawIssue(n + 1))
    const second = Array.from({ length: 3 }, (_, n) => rawIssue(200 + n))
    fetchMock
      .mockResolvedValueOnce(searchResponse(first, { total_count: 103 }))
      .mockResolvedValueOnce(searchResponse(second, { total_count: 103 }))
    const items = await fetchRepoIssues('acme/widget')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('page')).toBe('2')
    expect(items).toHaveLength(103)
  })

  it('reads the sub-issue summary the search response carries for free', async () => {
    fetchMock.mockResolvedValue(searchResponse([
      rawIssue(1, { sub_issues_summary: { total: 5, completed: 2 } }),
    ]))
    const [issue] = await fetchRepoIssues('acme/widget')
    expect(issue.childTotal).toBe(5)
    expect(issue.completedChildren).toBe(2)
  })

  it('throws GitHubError with the reset instant when quota is gone', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-reset': '1763610000' }),
      json: async () => ({}),
    })
    const error = await fetchRepoIssues('acme/widget').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubError)
    expect(isRateLimited(error)).toBe(true)
    expect((error as GitHubError).resetAt).toBe(1763610000 * 1000)
  })

  it('rejects repository names that are not owner/name', async () => {
    await expect(fetchRepoIssues('acme')).rejects.toThrow('owner/name')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('loadRepoIssues', () => {
  it('serves the session cache within the TTL and forces past it', async () => {
    fetchMock.mockResolvedValue(searchResponse([rawIssue(1)]))

    const fresh = await loadRepoIssues('acme/widget')
    expect(fresh.cached).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const cached = await loadRepoIssues('acme/widget')
    expect(cached.cached).toBe(true)
    expect(cached.items).toEqual(fresh.items)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await loadRepoIssues('acme/widget', true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches per repository, so a second board does not share entries', async () => {
    fetchMock.mockResolvedValue(searchResponse([rawIssue(1)]))
    await loadRepoIssues('acme/widget')
    await loadRepoIssues('acme/other')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await loadRepoIssues('acme/widget')
    await loadRepoIssues('acme/other')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('goes back to the network when storage throws', async () => {
    fetchMock.mockResolvedValue(searchResponse([rawIssue(1)]))
    // happy-dom's Storage prototype is not in the call path of its sessionStorage
    // facade, so replace the global outright with a hostile one.
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('storage denied') },
      setItem: () => { throw new Error('storage denied') },
    })
    try {
      await loadRepoIssues('acme/widget')
      await loadRepoIssues('acme/widget')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
