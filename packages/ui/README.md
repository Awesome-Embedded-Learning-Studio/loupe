# @aels/loupe-ui

面向教程站的 Vue 组件层：串口终端、整机实验外壳和 GitHub issue 卡片墙，配合
[@aels/wasm-runtime-host](https://github.com/Awesome-Embedded-Learning-Studio/loupe/tree/main/packages/wasm-runtime-host)
在浏览器里跑 micro-forge 引擎。

## 安装

```sh
pnpm add @aels/loupe-ui @aels/wasm-runtime-host
```

两个包都要显式安装：worker 薄壳要从根入口和 `./worker` 子路径两边拿导出。样式随组件注入，不需要单独 import CSS。产物按模块分块，只引 IssueBoard 的站点不会带上引擎相关的代码。

## IssueBoard：issue 卡片墙

不碰引擎，浏览器直连 GitHub 公共搜索 API，无 token，带每仓库 5 分钟的会话缓存，限额超了降级成提示条：

```vue
<script setup lang="ts">
import { IssueBoard } from '@aels/loupe-ui'
</script>

<template>
  <IssueBoard repo="Awesome-Embedded-Learning-Studio/loupe" />
</template>
```

## LabShell：整机实验外壳

先写一个 worker 薄壳，放在站点自己的源码树里，路径必须相对站点模块，打包器才能把它打进产物：

```ts
// src/engine-worker.ts
import { EngineWorkerLogic, bindEngineWorker } from '@aels/wasm-runtime-host/worker'
import { OpfsCacheBackend } from '@aels/wasm-runtime-host'

const logic = new EngineWorkerLogic((event) => self.postMessage(event), {
  backend: new OpfsCacheBackend(),
})
bindEngineWorker(logic, self)
```

页面里递上 manifest 地址和 worker 工厂：

```vue
<script setup lang="ts">
import { LabShell } from '@aels/loupe-ui'

const createWorker = () =>
  new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })
</script>

<template>
  <LabShell manifest="/lab/manifest.json" :create-worker="createWorker" />
</template>
```

manifest 是一份静态 JSON，构建期生成，描述引擎和若干内核/磁盘组合：

```json
{
  "engine": { "url": "/lab/engine.wasm", "bytes": 1048576, "md5": "…" },
  "presets": [
    {
      "id": "linux-6.6",
      "label": "Linux 6.6 + ext2",
      "kernel": { "url": "/lab/kernel.bin", "bytes": 2048, "md5": "…" },
      "disk": { "url": "/lab/ext2.img", "bytes": 8388608, "md5": "…" }
    }
  ]
}
```

拉 manifest、下载、引导、暂停恢复这些流程和机器生命周期都在组件里，站点只出 manifest 地址和 worker 工厂两样。引擎、内核、磁盘资产按 URL 分发，不走 npm。

## 进阶：自己拼界面

`TermConsole`、`loadRepoIssues`、`keyToBytes` 等导出可以单独拿。仓库 demo 目录的 App.vue 用 TermConsole 和 EngineClient 自己拼了一个控制台页面，可以当参考。

## License

MIT
