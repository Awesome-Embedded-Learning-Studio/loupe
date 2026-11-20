<script setup lang="ts">
import { ref } from 'vue'
import { IssueBoard } from '@aels/loupe-ui'

// Point the board at any `owner/name`; the component reloads when the prop
// changes. The dark toggle only flips a class on this wrapper — the board's
// own tokens do the rest.
const draft = ref('Awesome-Embedded-Learning-Studio/loupe')
const repo = ref(draft.value)
const dark = ref(false)

function apply(): void {
  const next = draft.value.trim()
  if (next && next !== repo.value) repo.value = next
}
</script>

<template>
  <div class="page" :class="{ dark }">
    <header class="bar">
      <h1>loupe · Issue 看板</h1>
      <label class="repo-edit">
        仓库
        <input v-model="draft" type="text" spellcheck="false" placeholder="owner/name" @keyup.enter="apply" />
      </label>
      <button type="button" @click="apply">切换</button>
      <button type="button" @click="dark = !dark">{{ dark ? '浅色' : '深色' }}</button>
      <a href="./index.html">引擎 demo ↗</a>
    </header>
    <main class="content">
      <IssueBoard :repo="repo" />
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f0ede4;
  transition: background 160ms;
}
.page.dark { background: #0d0b07; }

.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(128, 110, 70, 0.25);
  font-family: system-ui, 'PingFang SC', 'Noto Sans SC', sans-serif;
  font-size: 13px;
  color: #2b2620;
}
.page.dark .bar { color: #d8cfba; border-bottom-color: rgba(120, 100, 60, 0.35); }

h1 { font-size: 18px; margin: 0; font-weight: 650; }

.repo-edit { display: inline-flex; align-items: center; gap: 6px; color: inherit; }
.repo-edit input {
  width: 260px;
  padding: 5px 9px;
  font: inherit;
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  border: 1px solid #c9bfa4;
  border-radius: 4px;
  background: #fffdf4;
  color: inherit;
}
.page.dark .repo-edit input { border-color: #332b1e; background: #1e1913; }

.bar button {
  padding: 5px 10px;
  min-height: 32px;
  font: inherit;
  color: inherit;
  border: 1px solid #c9bfa4;
  border-radius: 4px;
  background: transparent;
}
.page.dark .bar button { border-color: #332b1e; }
.bar a { color: inherit; }

.content { max-width: 1152px; margin: 0 auto; padding: 6px 18px 36px; }
</style>
