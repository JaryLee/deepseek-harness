# Agent Note: workspace 构建只把声明了清单的目录当作包

Status: implemented

[English](2026-09-11-workspace-build-requires-package-manifest.md) | 中文

## Problem

`tsdown.config.ts` 原先以目录模式（`packages/*/*`、`vendor/*`、`apps/cli`）声明 workspace，而 tsdown 会把这类模式解析成目录，于是一个被删除的包遗留下来的目录即便没有 `package.json` 也会成为构建目标。该目录会继承根配置，包括其默认 `entry` `lib/types/{index,invariant,startup}.js`；当该 entry 在该目录下一个文件也匹配不到时，构建以 `Cannot find entry` 中止，标签取自 tsdown 向上找到的最近清单名，即仓库根的 `@deepseek-ai/dsh-root`。若该残留目录里还留着被删包产生的 `lib/types/index.js`，则会通过 entry 检查，并在它自己的 `lib/` 下产出 bundle。

## Decision

`tsdown.config.ts` 现在通过 `scripts/workspace-packages.ts` 的 `workspacePackageDirectories(process.cwd(), patterns)` 推导 workspace：该函数返回模式之下含 `package.json` 的目录，并剔除任何位于 `node_modules` 内的路径。没有清单的目录不是 workspace 成员，这与 pnpm 的成员判定一致，因此构建既不把它当作目标，也不会对它解析包 entry。枚举根为调用目录，也就是未传 `cwd` 时 tsdown 解析 workspace 模式所用的目录。陈旧目录的移除仍归 `pnpm run clean`（[TSC 优先构建](../process/2026-06-17-ts-build-config.zh.md)），构建依旧不会自动调用 clean。

## Alternatives considered

**每次构建前都执行 clean。** 由 [TSC 优先构建笔记](../process/2026-06-17-ts-build-config.zh.md)否决：即便 workspace 布局未变，它也会丢弃 `tsc` 与打包器持有的增量状态。

**按名字排除残留目录。** 否决：残留取决于下一个被删除的包留下什么，而且目录排除无法表达“没有清单”这一条件。

**当模式匹配到无清单目录时让构建失败。** 否决：该策略归 `pnpm run clean` 所有，包括它拒绝删除未知文件的行为，而无清单残留并不会让本来正确的构建出错。

## Consequences

- 被删除包的残留不再中止构建，构建也不再往该残留里写 bundle。
- `pnpm run clean` 仍是唯一移除该残留的命令，它依旧会拒绝移除含有 `node_modules`、`lib`、`.typecheck`、`*.tsbuildinfo` 之外文件的无清单目录。
- 缺少 `package.json` 的目录不会被构建。构建名册即清单成员集合，因此丢失清单的包会从构建中消失，而不会以仓库根的名字参与构建。

## Testing

`scripts/workspace-packages.spec.ts` 覆盖含清单目录的选取、带与不带陈旧 `lib/types/index.js` 的残留，以及 `node_modules` 内的清单。在 `packages/` 下放一个持有陈旧 `lib/types/index.js` 的无清单目录时，`pnpm run build` 仍能完成 Host 与 Client 两个 tsdown pass 及 Web 构建，且 `tsdown:config:workspace` 调试通道列出的目录中不含残留。
