<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { GitHubError, isRateLimited, loadRepoIssues } from './issue-live'
import type { IssueRecord } from './issue-live'

/**
 * Open-issue card wall for a single GitHub repository.
 *
 * The browser talks to the public search API directly (no token, no build
 * step) through a 5-minute per-repo session cache; quota failures degrade to
 * a notice naming the reset time. Open sub-issues reported under a visible
 * parent fold into the parent's meter instead of repeating as their own
 * cards. The warm-paper palette ships as component-local defaults, so a host
 * page gets the Awesome-Embedded look without importing its stylesheet, and
 * every color is retunable by redefining one `--ib-*` variable.
 */
defineOptions({ name: 'IssueBoard' })

const props = withDefaults(
  defineProps<{
    /** Repository to watch, as `owner/name`. */
    repo: string
    /** English copy instead of Chinese. */
    en?: boolean
  }>(),
  { en: false },
)

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

const state = ref<'loading' | 'ready' | 'error'>('loading')
const items = ref<IssueRecord[]>([])
const fetchedAt = ref(0)
const fromCache = ref(false)
const refreshing = ref(false)
const errMsg = ref('')
const resetAt = ref<number | null>(null)
const nowMs = ref(Date.now())
const avatarFailed = reactive(new Set<string>())

// Guards stale replies when the repo prop switches mid-flight.
let generation = 0
let active = 0

/** Cards visible on the wall: sub-issues with a visible parent fold away. */
const cards = computed(() => {
  const visible = new Set(items.value.map((issue) => issue.key))
  return items.value.filter((issue) => {
    const parent = issue.parentKey
    return !parent || parent === issue.key || !visible.has(parent)
  })
})

const syncLabel = computed(() => {
  const time = new Date(fetchedAt.value).toLocaleTimeString(props.en ? 'en-US' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  if (fromCache.value) return props.en ? `Cached from ${time}` : `${time} 的缓存`
  return props.en ? `Synced at ${time}` : `${time} 已同步`
})

function describeError(error: unknown): string {
  if (isRateLimited(error))
    return props.en ? 'GitHub API quota exhausted.' : 'GitHub 接口额度用完了。'
  if (error instanceof GitHubError) return `GitHub HTTP ${error.status}`
  return props.en ? 'Could not load issues from GitHub.' : '没能从 GitHub 取到 Issue。'
}

function resetText(ms: number | null): string {
  if (!ms) return ''
  const time = new Date(ms).toLocaleTimeString(props.en ? 'en-US' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return props.en ? `Resets around ${time}.` : `大约 ${time} 恢复。`
}

function initialsOf(author: string | null): string {
  return author?.slice(0, 2).toUpperCase() || '?'
}

function doneOf(issue: IssueRecord): number {
  return Math.min(issue.completedChildren, issue.childTotal)
}

/** One of four label tints, by name family; anything else stays neutral. */
function labelKind(label: string): 'bug' | 'help' | 'feat' | 'doc' | 'other' {
  const name = label.toLowerCase()
  if (/(bug|regression|fix)/.test(name)) return 'bug'
  if (/(help|question|good first|first)/.test(name)) return 'help'
  if (/(feat|feature|enh|improve)/.test(name)) return 'feat'
  if (/(doc|docs|documentation)/.test(name)) return 'doc'
  return 'other'
}

/** Relative age of an ISO timestamp, coarse (min/h/d), then a plain date. */
function displayDate(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  const minutes = Math.floor(Math.max(0, now - then) / 60000)
  if (minutes < 1) return props.en ? 'just now' : '刚刚'
  if (minutes < 60) return props.en ? `${minutes} min ago` : `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return props.en ? `${hours} h ago` : `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return props.en ? `${days} d ago` : `${days} 天前`
  const date = new Date(then)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function load(force = false): Promise<void> {
  const scope = props.repo.trim()
  const version = ++generation
  if (!REPO_RE.test(scope)) {
    state.value = 'error'
    errMsg.value = props.en
      ? 'Repository must be written as owner/name.'
      : '仓库得写成 owner/name 的形式。'
    resetAt.value = null
    return
  }
  active++
  refreshing.value = true
  errMsg.value = ''
  resetAt.value = null
  if (state.value !== 'ready') state.value = 'loading'
  try {
    const payload = await loadRepoIssues(scope, force)
    if (version !== generation) return
    items.value = payload.items
    fetchedAt.value = payload.at
    fromCache.value = payload.cached
    nowMs.value = Date.now()
    avatarFailed.clear()
    state.value = 'ready'
  } catch (error) {
    if (version !== generation) return
    errMsg.value = describeError(error)
    resetAt.value = isRateLimited(error) ? (error as GitHubError).resetAt : null
    if (state.value !== 'ready') state.value = 'error'
  } finally {
    active--
    if (active === 0) refreshing.value = false
  }
}

watch(
  () => props.repo,
  () => void load(true),
)
onMounted(() => void load())
</script>

<template>
  <div class="issue-board">
    <div v-if="state === 'loading'" class="board-notice" role="status">
      {{ en ? 'Fetching open issues from GitHub…' : '正在从 GitHub 读取开放 Issue…' }}
    </div>
    <div v-else-if="state === 'error'" class="board-notice">
      <p role="alert">{{ errMsg }} {{ resetText(resetAt) }}</p>
      <button class="control" type="button" @click="load(true)">{{ en ? 'Retry' : '重试' }}</button>
      <a
        class="github-link"
        :href="`https://github.com/${repo}/issues`"
        target="_blank"
        rel="noopener"
      >
        {{ en ? 'Browse on GitHub' : '去 GitHub 看' }} ↗
      </a>
    </div>
    <template v-else>
      <p v-if="errMsg" class="board-notice" role="status">{{ errMsg }} {{ resetText(resetAt) }}</p>
      <section class="board-panel" :aria-label="en ? 'Open issues' : '开放 Issue 看板'">
        <header class="board-head">
          <div class="scope">
            <div class="nav-caption">
              {{ en ? 'Issue board · current scope' : 'Issue 看板 · 当前范围' }}
            </div>
            <h2 class="scope-title">{{ repo }}</h2>
          </div>
          <div class="head-tools">
            <span class="sync mono">{{ syncLabel }}</span>
            <button class="control" type="button" :disabled="refreshing" @click="load(true)">
              {{ refreshing ? (en ? 'Syncing…' : '同步中…') : en ? 'Refresh' : '刷新' }}
            </button>
          </div>
        </header>
        <div class="list-bar">
          <span aria-live="polite"
            >{{ cards.length }} {{ en ? 'issue cards' : '张 Issue 卡片' }}</span
          >
          <span>{{ en ? 'Recently updated first' : '最近更新优先' }}</span>
        </div>
        <div class="board-results">
          <p v-if="!cards.length" class="empty">
            {{ en ? 'No open issues in this repository.' : '这个仓库当前没有开放的 Issue。' }}
          </p>
          <ul v-else class="issue-grid" role="list">
            <li v-for="issue in cards" :key="issue.key">
              <article class="issue-card">
                <div class="card-top">
                  <div class="who">
                    <img
                      v-if="issue.avatarUrl && !avatarFailed.has(issue.key)"
                      class="avatar"
                      :src="issue.avatarUrl"
                      alt=""
                      width="25"
                      height="25"
                      loading="lazy"
                      @error="avatarFailed.add(issue.key)"
                    />
                    <span v-else class="avatar initials" aria-hidden="true">{{
                      initialsOf(issue.author)
                    }}</span>
                    <div class="byline">
                      <span class="author" :title="issue.author ?? undefined">
                        {{ issue.author ?? (en ? 'Unknown author' : '未知作者') }}
                      </span>
                      <span class="ref mono">#{{ issue.number }}</span>
                    </div>
                  </div>
                  <span
                    v-if="issue.labels.length"
                    class="label"
                    :class="`label-${labelKind(issue.labels[0])}`"
                  >
                    {{ issue.labels[0]
                    }}<template v-if="issue.labels.length > 1">
                      +{{ issue.labels.length - 1 }}</template
                    >
                  </span>
                </div>
                <h3 class="issue-title">
                  <a
                    :href="issue.url"
                    target="_blank"
                    rel="noopener"
                    :title="en ? 'Open on GitHub' : '在 GitHub 打开'"
                    >{{ issue.title }}</a
                  >
                </h3>
                <div class="card-foot">
                  <time :datetime="issue.updatedAt"
                    >{{ en ? 'Updated' : '更新' }} {{ displayDate(issue.updatedAt, nowMs) }}</time
                  >
                  <span v-if="issue.childTotal > 0" class="meter">
                    <progress :value="doneOf(issue)" :max="issue.childTotal" />
                    <span>{{
                      en
                        ? `${doneOf(issue)}/${issue.childTotal} sub-issues`
                        : `子任务 ${doneOf(issue)}/${issue.childTotal}`
                    }}</span>
                  </span>
                  <span v-if="issue.comments"
                    >{{ issue.comments }} {{ en ? 'comments' : '条评论' }}</span
                  >
                </div>
              </article>
            </li>
          </ul>
        </div>
      </section>
      <p class="board-foot">
        {{ syncLabel }} ·
        {{
          en
            ? "Open sub-issues fold into their parent card's meter."
            : '开放的子任务折进父卡片的进度条，不重复占卡。'
        }}
      </p>
    </template>
  </div>
</template>

<style scoped>
/* Warm-copper AELS palette shipped as defaults (see the component doc).
   Light = warm paper; an ancestor `.dark` flips to the amber-CRT set. */
.issue-board {
  --ib-font-base:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    'Noto Sans SC', 'Microsoft YaHei', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --ib-font-mono: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace;
  --ib-radius-sm: 4px;
  --ib-radius-md: 6px;
  --ib-brand-1: #33804a;
  --ib-brand-2: #2a6e3e;
  --ib-brand-soft: rgba(51, 128, 74, 0.11);
  --ib-bg: #faf6ec;
  --ib-bg-soft: #f5efdf;
  --ib-bg-elv: #fffdf4;
  --ib-bg-mute: #eee7d3;
  --ib-border: #e7ddc6;
  --ib-divider: #e9e1cb;
  --ib-text-1: #2b2620;
  --ib-text-2: #5d5648;
  --ib-danger-1: #a23c2f;
  --ib-danger-soft: rgba(162, 60, 47, 0.1);
  --ib-warning-1: #a2620f;
  --ib-warning-soft: rgba(244, 162, 60, 0.22);

  margin: 20px 0 28px;
  font-family: var(--ib-font-base);
  font-size: 13px;
  color: var(--ib-text-1);
}
:global(.dark) .issue-board {
  --ib-brand-1: #85d689;
  --ib-brand-2: #6fbe75;
  --ib-brand-soft: rgba(133, 214, 137, 0.13);
  --ib-bg: #131009;
  --ib-bg-soft: #191510;
  --ib-bg-elv: #1e1913;
  --ib-bg-mute: #241e15;
  --ib-border: #332b1e;
  --ib-divider: #2e2820;
  --ib-text-1: #f2ebdd;
  --ib-text-2: #b5aa94;
  --ib-danger-1: #e08575;
  --ib-danger-soft: rgba(224, 133, 117, 0.14);
  --ib-warning-1: #ffb454;
  --ib-warning-soft: rgba(255, 180, 84, 0.2);
}

.board-panel,
.board-notice {
  border: 1px solid var(--ib-divider);
  border-radius: var(--ib-radius-md);
  background: var(--ib-bg-elv);
  min-width: 0;
}
.board-notice {
  padding: 12px;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--ib-text-2);
}
.board-notice p {
  margin: 0 0 6px;
}
.github-link {
  margin-inline-start: 10px;
}

.board-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px 10px;
}
.nav-caption {
  font-size: 11px;
  color: var(--ib-text-2);
  font-weight: 650;
}
.scope-title {
  margin: 2px 0 0;
  padding: 0;
  border: 0;
  font-size: 19px;
  line-height: 1.4;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.head-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.sync {
  font-size: 11px;
  color: var(--ib-text-2);
}
.control {
  min-height: 34px;
  max-width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--ib-border);
  border-radius: var(--ib-radius-sm);
  background: var(--ib-bg-elv);
  color: var(--ib-brand-1);
  font: inherit;
  font-size: 13px;
}
.control:disabled {
  opacity: 0.65;
  cursor: wait;
}
.issue-board :is(button, a):focus-visible {
  outline: 2px solid var(--ib-brand-1);
  outline-offset: 2px;
}

.list-bar {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 14px;
  border-block: 1px solid var(--ib-divider);
  background: var(--ib-bg-soft);
  font-size: 12px;
  color: var(--ib-text-2);
}
.board-results {
  padding: 10px;
}
.empty {
  margin: 0;
  padding: 10px;
  font-size: 13px;
  color: var(--ib-text-2);
}

.issue-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 235px), 1fr));
  gap: 10px;
  align-items: stretch;
  padding: 0;
  margin: 0;
  list-style: none;
}
.issue-grid > li {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
}
@media (max-width: 639px) {
  .issue-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.issue-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--ib-divider);
  border-radius: var(--ib-radius-md);
  background: var(--ib-bg);
  padding: 11px 12px;
}
.issue-card:hover {
  border-color: var(--ib-brand-2);
}
.card-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) fit-content(49%);
  align-items: center;
  gap: 8px;
}
.who {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.avatar {
  display: block;
  width: 25px;
  height: 25px;
  border-radius: 50%;
  flex: none;
  object-fit: cover;
  background: var(--ib-bg-mute);
}
.avatar.initials {
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--ib-brand-1);
}
.byline {
  min-width: 0;
  display: grid;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}
.ref {
  color: var(--ib-text-2);
  font-size: 11px;
  align-self: start;
}
.label {
  border-radius: 99px;
  padding: 1px 7px;
  font-size: 11px;
  line-height: 1.5;
  background: var(--ib-bg-mute);
  color: var(--ib-text-2);
  overflow-wrap: anywhere;
}
.label-bug {
  color: var(--ib-danger-1);
  background: var(--ib-danger-soft);
}
.label-help {
  color: var(--ib-warning-1);
  background: var(--ib-warning-soft);
}
.label-feat,
.label-doc {
  color: var(--ib-brand-1);
  background: var(--ib-brand-soft);
}

.issue-card .issue-title {
  margin: 8px 0 7px;
  padding: 0;
  font-size: 14px;
  line-height: 1.45;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.issue-title a {
  color: var(--ib-text-1);
  text-decoration: none;
}
.issue-title a:hover {
  color: var(--ib-brand-1);
  text-decoration: underline;
}

.card-foot {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 8px;
  align-items: center;
  color: var(--ib-text-2);
  font-size: 11px;
}
.meter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ib-brand-1);
  font-variant-numeric: tabular-nums;
}
.meter progress {
  appearance: none;
  border: 0;
  width: 34px;
  height: 5px;
  border-radius: 5px;
  background: var(--ib-bg-mute);
  overflow: hidden;
}
.meter progress::-webkit-progress-bar {
  background: var(--ib-bg-mute);
}
.meter progress::-webkit-progress-value {
  background: var(--ib-brand-1);
  border-radius: 5px;
}
.meter progress::-moz-progress-bar {
  background: var(--ib-brand-1);
  border-radius: 5px;
}

.board-foot {
  margin: 9px 0 0;
  font-size: 12px;
  color: var(--ib-text-2);
}
</style>
