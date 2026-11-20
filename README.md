# loupe

浏览器里的嵌入式实验室。[AELS](https://github.com/Awesome-Embedded-Learning-Studio) 各教程站在 VitePress 页面里嵌入的 Vue 组件与 wasm 运行时宿主，也可以在你自己的站点里选用。

## 包

| 包                                                      | 说明                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@aels/loupe-ui`](packages/ui)                         | Vue 组件层：串口终端 `TermConsole`、实验外壳 `LabShell`、Issue 看板 `IssueBoard`。组件只接 `@aels/wasm-runtime-host` 的机器句柄，不碰 wasm ABI |
| [`@aels/wasm-runtime-host`](packages/wasm-runtime-host) | 无框架 TypeScript 库：micro-forge 引擎加载与 ABI 校验、机器生命周期、运行循环、串口流、资产缓存、worker 协议                                   |
| [`demo`](demo)                                          | 本地试玩页，两个页面：引擎 playground 与 IssueBoard 演示                                                                                       |

## 开发

```bash
pnpm install
pnpm lint        # eslint
pnpm format      # prettier --write .
pnpm typecheck
pnpm test        # vitest；引擎产物不在时引擎用例自动跳过
pnpm dev         # demo 页，http://127.0.0.1:8090/
pnpm build
```

引擎三件套（`engine.wasm`、`kernel.bin`、`ext2.img`）不进仓，构建与拷贝方式见 [demo/README.md](demo/README.md)。

## 许可证

[MIT](LICENSE)
