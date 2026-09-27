# 双 Fork 基线验证

本目录是 ActionDriver 自有测试代码；不扩展上游 Playwright 或 Chromium 行为，不接入 ActionDriver 产品。

## 当前状态

Playwright 与 Electron 已从源码构建，darwin-arm64 双 Fork 基础兼容验证已通过。Electron 38.8.6 / Chromium 140.0.7339.249；真实导航、点击、输入、截图、正常关闭、失败清理和版本不匹配清理通过。定向测试 14/14，通过记录为 thridparty/logs/fork-baseline-built-tests.log。导出程序为 thridparty/build/electron/Electron.app，截图为 thridparty/build/verification/baseline.png。产品接入与具体接口扩展尚未实施。

## 锁定来源

| 来源 | 版本 / 提交 |
| --- | --- |
| jt-jiangtao/playwright | v1.63.0 / `1b025d7e20a026371cd5f98ba0cdce48892737c8` |
| jt-jiangtao/electron | v38.8.6 / `fbc489c43be82f0fc331560ae678a39aeaea38c8` |
| Chromium（Electron DEPS） | 140.0.7339.249 / `51dd6cfc5c0bb8a297725ae9270ca43fb0fcc8e2` |
| depot_tools | `41c9bd890277c2f551499d171d215dfdf5dab97d` |
| 本地 Node | v22.23.3 / darwin-arm64 |

Chromium 使用官方 GitHub 镜像传输同一提交；同步后已核验原始提交；Electron 上游补丁应用后的 Chromium HEAD 为 `31c3b2fb7d154bd181fdf73ec6e9a6c36e38312f`，其与原始提交的 merge-base 相同。Node 放在 `thridparty/tools/`，不改变系统默认版本。

## 构建与验证

在 `thridparty/playwright/` 运行 `npm ci`、`npm run build`，使用项目内 Node 的 session PATH。编译模块为 `packages/playwright-core/index.js`。

Electron 在 `thridparty/build/electron-workspace/` 执行锁定 revision 的 `gclient sync --no-history --revision src/electron@fbc489c43be82f0fc331560ae678a39aeaea38c8`。在 `src/` 生成 `out/ActionDriver`，配置为 `import("//electron/build/args/testing.gn") target_cpu="arm64" mac_sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk" enable_precompiled_headers=false`，实际使用同步的 `buildtools/mac/gn` 生成配置，使用 `third_party/ninja/ninja -C out/ActionDriver -j8 electron` 编译；depot_tools 包装脚本缺少 bootstrap Python 文件，未修改上游脚本。中间文件留在上游规定的位置，导出产物放 `thridparty/build/`。

构建完成后生成本机 `manifest.json`（本目录 .gitignore 排除；绝对路径和产物校验值属于本机运行记录），记录真实 checkout HEAD、版本、绝对产物路径、GN 参数路径与 SHA-256，并记录 playwright-core 全目录 runtimeSha256、Electron.app 全目录 appSha256 和 appRoot；未构建前不提供虚假的完整 manifest。验证入口为 `node action_driver/baseline/smoke.mjs`。该入口先调用 `verifyManifest`，再启动自有 Electron。截图导出到 `thridparty/build/verification/`。

定向测试：

```sh
node --test action_driver/baseline/verify.test.mjs
node --test action_driver/baseline/smoke.test.mjs
```

第二条需要真实构建及本机 manifest。测试正常关闭和故意定位失败时的进程、HTTP server 清理；缺失、错误校验值或版本不符均失败。

## 自有差异规则

Playwright 自有代码只放 `action_driver/`。使用 `git diff 1b025d7e20a026371cd5f98ba0cdce48892737c8 -- . ':!action_driver'` 检查上游路径，并同时检查暂存区与未追踪文件。本期不修改上游行为。

Electron 本期没有自有行为补丁。后续 Chromium 行为补丁须由 Electron 补丁队列保存并受 `ACTION_DRIVER` 宏控制；上游已有补丁不属于自有差异。本期宏开关行为验证不适用。

## 已知检查失败

`npm run flint` 中除文档检查外的子项通过。文档检查安装官方浏览器工具后，Firefox 155.0 仍报 `Could not find profile folder`；使用存在的项目内 profile 目录直接启动也失败。工具位于 `thridparty/tools/doclint-browsers/`，日志位于 `thridparty/logs/`，不作为最终兼容测试的运行产物。

实测环境：macOS 27.0、arm64、10 核、32 GiB 内存，Xcode 27.0（27A266a）、系统 Python 3.9.6、构建 Clang 21.0.0git（bd809ffb）。同步完成前检查剩余磁盘约 523 GiB。GN 已生成 28,647 个目标，构建日志在 `thridparty/logs/electron-build-auto-module.log`。

SDK 27 的 math.h 与锁定 Clang/libc++ 组合编译 <random> 时缺少 INFINITY；相同最小例使用现有 SDK 26.5 通过。GN 已显式选择 SDK 26.5，无源码修改或系统默认切换；诊断在 electron-sdk-diagnostic.log。

本次 GN args.gn SHA-256：`4d12bd95411e761fcbf052969e46b67ae872f81776e4a8e9fbb1ad1039f35312`。Chromium 原始提交到补丁后 HEAD 包含 Electron 上游的 144 个补丁提交；本期自有 Chromium 行为补丁为零。已扫描 Playwright 已追踪差异与未追踪文件，自有文件均在 action_driver/。Electron Fork 已追踪差异为零。

Xcode 27 缺少独立 Metal Toolchain 导致 ANGLE shader 编译失败。按上游要求执行 `xcodebuild -downloadComponent MetalToolchain -exportPath /Users/jiangtao/coding/action-driver/thridparty/tools/metal-toolchain`，安装并导出 27A266a；Apple metal 32023.921 可正常调用。Xcode 管理系统资产注册，导出副本位于 tools/metal-toolchain；未改变源码。

项目内嵌套工作区需保留 thridparty/package.json 的 `{"private":true}` 包边界，否则 Chromium 的 css_minifier.js 会继承产品根 type=module。边界放在源码 checkout 之外；之前失败的 CSS 目标在添加边界后单独构建通过。

目录校验将相对路径与各文件 SHA-256 排序后汇总；符号链接记录链接目标，不重复遍历。启动前同时检查模块入口、启动器、全部运行目录及 GN 参数，防止入口文件未变而 lib/Framework 已被替换。校验定向测试 11/11 通过，其中两个运行目录篡改用例已观察 RED→GREEN。

包边界不设置 type：显式 commonjs 会让 Chromium 的 ESM minify_js.js 失败；保留私有 package.json、交给 Node 22 自动语法识别，CSS CommonJS 与 Lit ESM 两个真实构建命令均通过。

### macOS 文件描述符限制

续建前在同一终端执行 `ulimit -n 65536`，再运行 Ninja。macOS launchctl 默认软限制为 256；Clang 在该限制下可能报 `Too many open files`。2026-09-27 用 `obj/third_party/blink/renderer/platform/wtf/wtf/partition_allocator.o` 定向验证：限制 256 时失败，65536 时同一目标通过（退出码 0）。日志分别为 `thridparty/logs/electron-fd-limit-256.log` 与 `electron-fd-limit-65536.log`。此设置只作用于当前 shell 及子进程，不修改系统全局配置或上游代码。

### Blink GC 插件与 PCH

锁定 Clang 版本与源码要求一致（llvmorg-21-init-16348-gbd809ffb-15）。xpath_grammar_generated.o 在加载 PCH 时对 HashTable 内部字段报 blink-gc invalid fields；上游 HashTable 的 GC_PLUGIN_IGNORE_FILE 标记由插件 PragmaHandler 收集，PCH 加载未恢复此状态。同一编译命令仅移除 PCH 后通过，GC 插件仍开启。使用上游 GN 开关 `enable_precompiled_headers = false` 并重新生成 out/ActionDriver，避免该兼容问题；不修改上游源码、不关闭 GC 插件。代价是相关目标重编及编译速度下降。诊断日志为 electron-blink-gc-diagnostic.log、electron-blink-gc-no-pch.log，新 GN 配置生成的目标命令直接执行通过（退出码 0），日志为 electron-blink-gc-no-pch-target-replay.log；Ninja 依赖重编验证 electron-blink-gc-no-pch-target.log 由 Agent 主动停止。全量构建仍待完成。

### Node 配置生成的 GN 查找

`generate_config_gypi.py` 通过 PATH 调用 gn。续建 PATH 必须将 `thridparty/build/electron-workspace/src/buildtools/mac` 放在 depot_tools 前面，选择已同步的原生 GN；depot_tools 包装器缺少 python3_bin_reldir.txt。2026-09-27 续建在 gen/third_party/electron_node/config.gypi 复现包装器错误，使用原生 GN 定向验证。上游源码不变。
