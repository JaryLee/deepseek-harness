---
description: "Web 导入界面：列出 Codex 与 Claude Code 会话并经宿主 `/import` 命令导入其中一个的会话头部动作与对话框；供导入体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-context-import

[English](README.md) | 中文

## 概述

本包渲染 Web GUI 的导入界面：一个会话头部动作（导入会话 / Import session），以及它打开的对话框。对话框列出宿主上报的外部会话，按工具分组、按工具筛选（默认 Codex）、按标题或 id 搜索，并分页浏览匹配项；每一行要么导入为新的会话，要么注入当前会话。在输入框中键入裸 `/import` 也会打开同一个对话框。每次读取列表和每次导入都是一次宿主命令执行，对话框展示宿主自己的结果文本。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与运行时一起挂载本插件；导入动作随后出现在会话头部，其对话框既可从该动作打开，也可由输入框中键入的裸 `/import` 打开。

### 对话框

行按工具分组，顺序为 Codex、Claude Code；工具筛选默认停在 Codex，`全部` 解除筛选；搜索在宿主记录了标题时匹配标题，否则匹配 id，且不区分大小写；表格每页八行，超出末页的页码会被钳制回来。每行显示会话名、工作目录、最后一次外部写入的本地 `YYYY-MM-DD hh:mm` 时间戳，以及以 KiB 计的大小。`导入` 执行 `/import <tool> <id>`，`注入当前会话` 执行 `/import --inject <tool> <id>`，两者都经 `ctx.remote.commands.execute`。

### 对话框何时打开

会话头部动作会打开它，裸 `/import` 也会：插件监听 `command/executed`，只在成功的 `import` 结果文本以 `usage: ` 开头时打开对话框。`/import list` 与真正的导入会在输入区报告各自的结果，绝不会再次打开它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释浏览器半边的设计；可观察行为见[使用本包](#use-this-package)。

### 设计理念

本包向 `conversation.session.header.actions` 贡献一个条目（`ImportHeaderAction`，order 30），向 `conversation.input.overlay` 贡献一个条目（`ImportDialog`，order 3）。两者抵达同一个按 Session 划分的 `ImportSurface`，其中保存解析后的列表、筛选、搜索与页码输入、一个进行中的命令，以及最后一次结果；对话框经条目的 `hooks` 舱位读取该对象，并经注入的动词写入。`src/client/rows.ts` 把 `/import list` 文本解析为行，并在没有 React、也没有 `ctx` 的情况下完成分组、筛选、搜索与分页。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器入口：两个 slot 注册、`command/executed` 触发器、按 Session 划分的 surface |
| [`src/client/surface.ts`](src/client/surface.ts) | 对话框状态、两条命令行与分页投影 |
| [`src/client/rows.ts`](src/client/rows.ts) | 把 `/import list` 文本解析为行并筛选、搜索、分页 |
| [`src/client/ImportDialog.tsx`](src/client/ImportDialog.tsx) | 对话框渲染：工具栏、表格、状态行、页脚 |
| [`src/client/ImportHeaderAction.tsx`](src/client/ImportHeaderAction.tsx) | 打开对话框的会话头部触发器 |
| [`src/client/locales.ts`](src/client/locales.ts) | `contextImport` 字典 |
| [`src/index.ts`](src/index.ts) | 半边：空的 `apply`，让插件拥有 Loader 行 |

### 主要流程

打开对话框（来自会话头部动作或用法行）会发布 `open: true` 并执行 `/import list`；除非调用失败（对话框为此显示独立的读取失败状态），返回文本会被解析为行。行上的动作复用同一次调用，改为 `/import <tool> <id>` 或 `/import --inject <tool> <id>`，把宿主的结果文本发布为结果，并重新读取列表，因为一次导入可能改变还有哪些会话可导入。每次读取都带有世代号，因此被取代的读取即便结算也会被丢弃，而不会覆盖更新的行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

对话框本身不够用时阅读以下页面。它们从宿主命令进入相邻的客户端层次。

- [dsh-context-import](../../context/context-import/README.zh.md)——拥有 `/import`、解析与翻译的宿主插件。
- [client 组地图](../README.zh.md)——相邻的浏览器端包。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册 slot。

-----

<a id="model-experience"></a>
## 模型体验

### 对话框执行的宿主命令

#### 模型看到的内容

浏览器半边不发送自己的提示词。对话框背后一切模型可见的效果都属于宿主插件：`/import <tool> <id>` 为新的会话播种历史，`/import --inject <tool> <id>` 向对话框打开时所在的 Session 追加宿主那份精简的 `recall` 形式消息。

#### Token 影响

本包不产生任何 token。这些 token 由宿主插件的种子或注入消息携带，对话框不向其中添加任何文本。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前对话框。它们是当前包约束。

- **一次只导入一个会话**——对话框每个 Session 只运行一条命令，并在读取列表或导入进行期间禁用其动作，因此第二次导入要等第一次结算。
- **列表是文本线格式**——`/import list` 返回的是人读的文本，本包再把它解析回行，因此文本一旦偏离该格式，该行就会从表格中消失；没有任何类型化的 Remote 承载这份列表。
- **外部根目录很大时首次读取会变慢**——宿主会遍历配置根目录下的每个 `.jsonl` 文件并读取每个文件的开头，因此对话框第一次读取列表的耗时与这次遍历相当。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包持有两个 slot 条目与一个 locale 字典，全部由 effect 拥有并随插件 fiber 释放，另加仅存在于插件内存中的、按 Session 划分的对话框 surface；HMR 安全性规范验证了这些注册会被撤销，且不存在可供比对的第二权威。
