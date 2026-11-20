# @aels/wasm-runtime-host

micro-forge wasm 引擎的 TypeScript 宿主层。无框架、无 DOM：引擎加载带 ABI 检查、机器生命周期、运行循环按指令预算步进、串口数据流、资产缓存（内存或 OPFS），以及一套让引擎跑在 worker 里的消息协议。

## 安装

```sh
pnpm add @aels/wasm-runtime-host
```

## 入口

| 入口       | 内容                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| `.`        | 全部公共 API：`loadEngine`、`LoupeMachine`、`EngineClient`、`judgeSerial`、缓存后端等 |
| `./worker` | 引擎侧绑定：`EngineWorkerLogic`、`bindEngineWorker`，给 worker 薄壳用                 |

## worker 薄壳

worker 脚本放在站点自己的源码树里，路径相对站点模块，打包器才能把它打进产物：

```ts
// src/engine-worker.ts
import { EngineWorkerLogic, bindEngineWorker } from '@aels/wasm-runtime-host/worker'
import { OpfsCacheBackend } from '@aels/wasm-runtime-host'

const logic = new EngineWorkerLogic((event) => self.postMessage(event), {
  backend: new OpfsCacheBackend(),
})
bindEngineWorker(logic, self)
```

页面侧用 `EngineClient` 连 worker：构造时传 worker 实例和 handlers，boot、run、pause、inject 走消息协议，feed 与下载进度走回调。仓库 demo 目录的 App.vue 是完整示例。

组件封装见
[@aels/loupe-ui](https://github.com/Awesome-Embedded-Learning-Studio/loupe/tree/main/packages/ui)。

## License

MIT
