# loupe demo

本地试玩页。引擎跑在 dedicated worker 里(`src/worker.ts` 入口,`EngineClient` 通信),页面只管展示;URL 模式的镜像与引擎走 worker 内的 OPFS 缓存,二次引导不再下载。

另一个页面 `issues.html` 是 `IssueBoard` 的演示:输入任意 `owner/name` 即可把看板指向别的仓库,顶栏可切换明暗配色(组件自带暖纸与琥珀 CRT 两套默认 token)。

## 资产

demo 的 `public/` 不进 git,同时也是三件套的集散地:要往别处部署(如 Cinux 文档站的 `document/public/cinux-lab/`,或 Cinux-Book 的 `site/.vitepress/public/cinux-lab/`)时,直接从这里拷。刷新方式:

```bash
# 引擎仓构建(需要 emsdk;产物在 build-wasm/)
cd ~/micro-forge && cmake -S . -B build-wasm -DMICRO_FORGE_WASM=ON && cmake --build build-wasm
# 三件套拷入 demo(URL 模式默认取这三个名字)
cp ~/micro-forge/build-wasm/engine.wasm demo/public/engine.wasm
cp ~/Cinux/build/kernel/kernel.bin demo/public/kernel.bin
cp ~/Cinux/build/boot/ext2.img demo/public/ext2.img
```

两种引导方式:

- **本地文件**:文件选择器读 kernel.bin 与 ext2.img,不经过缓存。
- **URL(缓存)**:默认取 `./kernel.bin` 与 `./ext2.img`,可改;引擎固定 `./engine.wasm`。下载进度显示在状态栏,首次下载后存 OPFS。

页面上直接打字即串口输入(含方向键 ANSI、Ctrl+C);**判题演示**在暂停后可用,对 `echo loupe-judge-demo` 做串口断言。

## 命令

```bash
pnpm dev       # http://127.0.0.1:8090/
pnpm build     # vite build
pnpm typecheck # vue-tsc --noEmit
```
