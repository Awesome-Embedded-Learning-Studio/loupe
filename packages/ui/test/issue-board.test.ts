import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import IssueBoard from '../src/IssueBoard.vue'
import { GitHubError } from '../src/issue-live'
import type { IssueRecord } from '../src/issue-live'

// Only the data layer is mocked: the component under test keeps its real
// state machine, folding, and copy.
const loadRepoIssues = vi.fn()
vi.mock('../src/issue-live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/issue-live')>()
  return { ...actual, loadRepoIssues: (...args: Parameters<typeof actual.loadRepoIssues>) => loadRepoIssues(...args) }
})

function record(over: Partial<IssueRecord> & Pick<IssueRecord, 'number'>): IssueRecord {
  return {
    key: `acme/widget#${over.number}`,
    title: `Issue ${over.number}`,
    parentKey: null,
    author: 'alice',
    avatarUrl: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
    labels: [],
    url: `https://github.com/acme/widget/issues/${over.number}`,
    childTotal: 0,
    completedChildren: 0,
    comments: 0,
    ...over,
  }
}

beforeEach(() => {
  loadRepoIssues.mockReset()
})

async function mountBoard(props: { repo: string; en?: boolean }) {
  const wrapper = mount(IssueBoard, { props })
  await flushPromises()
  return wrapper
}

describe('IssueBoard', () => {
  it('renders one card per open issue, newest update first', async () => {
    loadRepoIssues.mockResolvedValue({
      repo: 'acme/widget',
      items: [
        record({ number: 2, updatedAt: '2026-11-12T00:00:00Z' }),
        record({ number: 1, updatedAt: '2026-11-02T00:00:00Z' }),
      ],
      at: Date.now(),
      cached: false,
    })
    const wrapper = await mountBoard({ repo: 'acme/widget' })

    // Data layer sorts; the board renders what it is given.
    const titles = wrapper.findAll('.issue-title').map((n) => n.text())
    expect(titles).toEqual(['Issue 2', 'Issue 1'])
    expect(wrapper.find('.list-bar span').text()).toContain('2')
    wrapper.unmount()
  })

  it('folds sub-issues under their visible parent instead of repeating them', async () => {
    loadRepoIssues.mockResolvedValue({
      repo: 'acme/widget',
      items: [
        record({ number: 1, childTotal: 2, completedChildren: 1 }),
        record({ number: 2, parentKey: 'acme/widget#1' }),
        record({ number: 3, parentKey: 'acme/widget#1' }),
        record({ number: 4 }),
      ],
      at: Date.now(),
      cached: false,
    })
    const wrapper = await mountBoard({ repo: 'acme/widget' })

    expect(wrapper.findAll('.issue-card')).toHaveLength(2)
    expect(wrapper.find('.meter').text()).toContain('1/2')
    wrapper.unmount()
  })

  it('keeps a sub-issue as its own card when the parent is not in scope', async () => {
    loadRepoIssues.mockResolvedValue({
      repo: 'acme/widget',
      items: [record({ number: 2, parentKey: 'acme/widget#1' })],
      at: Date.now(),
      cached: false,
    })
    const wrapper = await mountBoard({ repo: 'acme/widget' })
    expect(wrapper.findAll('.issue-card')).toHaveLength(1)
    wrapper.unmount()
  })

  it('shows the empty state for a repository without open issues', async () => {
    loadRepoIssues.mockResolvedValue({ repo: 'acme/widget', items: [], at: Date.now(), cached: false })
    const wrapper = await mountBoard({ repo: 'acme/widget' })
    expect(wrapper.find('.empty').text()).toContain('没有开放的 Issue')
    wrapper.unmount()
  })

  it('degrades to a reset-time notice when the quota is exhausted', async () => {
    const resetAt = new Date('2026-11-20T11:07:00+08:00').getTime()
    loadRepoIssues.mockRejectedValue(new GitHubError('rate limit', 403, resetAt))
    const wrapper = await mountBoard({ repo: 'acme/widget' })

    const notice = wrapper.find('.board-notice')
    expect(notice.text()).toContain('额度用完')
    expect(notice.text()).toContain('恢复')
    expect(wrapper.find('.control').text()).toBe('重试')
    wrapper.unmount()
  })

  it('rejects a malformed repo prop before any request', async () => {
    const wrapper = await mountBoard({ repo: 'not-a-repo' })
    expect(loadRepoIssues).not.toHaveBeenCalled()
    expect(wrapper.find('.board-notice').text()).toContain('owner/name')
    wrapper.unmount()
  })

  it('reloads when the repo prop switches', async () => {
    loadRepoIssues.mockResolvedValue({
      repo: 'acme/widget',
      items: [record({ number: 1 })],
      at: Date.now(),
      cached: false,
    })
    const wrapper = await mountBoard({ repo: 'acme/widget' })
    expect(wrapper.find('.scope-title').text()).toBe('acme/widget')

    await wrapper.setProps({ repo: 'acme/other' })
    await flushPromises()
    expect(loadRepoIssues).toHaveBeenLastCalledWith('acme/other', true)
    expect(wrapper.find('.scope-title').text()).toBe('acme/other')
    wrapper.unmount()
  })
})
