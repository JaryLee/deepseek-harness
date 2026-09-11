# Agent Note: 客户端 tsdown 预设从调用目录定位仓库根

Status: implemented

[English](2026-08-28-client-config-repository-root.md) | 中文

## Problem

`packages/client/tsdown.client.ts` 此前以 `import.meta.url` 向上两级推导 `REPOSITORY_ROOT`，这只在该模块从自身源文件位置求值时成立。tsdown 通过 unrun 加载包配置：unrun 把配置打包进 `node_modules/.unrun` 并改写 `import.meta.url`；依据模块内容的不同，改写结果可能落在入口配置文件、被内联的模块文件或打包输出文件上，三者深度各不相同。当入口配置文件的值胜出时，推导结果落在 `<repo>/packages/` 而不是仓库根，`workspaceManifest` 的 `packages/*/*/package.json` glob 匹配不到任何清单，所有使用客户端预设的包构建都以 `tsdown: no packages/*/*/package.json declares the name …` 中止。`browserSourcePath` 也会用同一个错误的根静默地重定客户端 sourcemap。

## Decision

`REPOSITORY_ROOT` 现在从进程工作目录向上寻找最近的、持有 `pnpm-workspace.yaml` 的祖先目录。tsdown 的 workspace 构建以仓库根为工作目录运行，聚焦单包构建以包目录运行，两类调用上下文都会上升到同一个根；而 `pnpm-workspace.yaml` 只存在于仓库根，因为本仓库只定义一个 workspace。从仓库之外调用时，配置求值阶段即刻报错，而不是去 glob 一个无关目录。

## Alternatives considered

**从 `import.meta.url` 而非 `process.cwd()` 向上查找。** 否决：unrun 的改写使该值依赖内容与版本，任何固定层级数的推导在 unrun 升级后仍然脆弱。

**由 `scripts/build.ts` 通过环境变量注入根目录。** 否决：该预设还会在直接调用 `tsdown` 的场景下求值（例如聚焦单包构建），那些场景没有编排层来设置该变量。

**向上搜索 `tsconfig.host.json`。** 否决：每个成员包都自带 face 配置，包目录之上第一个命中的是包本身而不是仓库根。

## Consequences

- `workspaceManifest` 在 workspace 构建与聚焦构建中都重新能解析每个 workspace 包清单，host 与 client 两个 pass 不再以清单缺失中止。
- `browserSourcePath` 在两类调用上下文中都基于稳定的根重定浏览器 sourcemap 源路径。
- 从仓库之外的目录运行该预设在配置求值时抛错，而不是产出错误重定的产物。

## Testing

仓库构建端到端地验证该推导：`pnpm run build` 完成 host 与 client 两个 tsdown pass 及 web 前端；在 `packages/api/remotes` 内执行 `pnpm exec tsdown --env.DSH_BUILD_FACE host`（即复现清单缺失中止的调用）在 Windows 上通过。
