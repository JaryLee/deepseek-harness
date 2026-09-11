---
description: "把 Codex 与 Claude Code 会话日志导入为新的 dsh 会话，或作为当前会话的 recall 上下文；供使用与维护 `/import` 及 `ctx.contextImport` 的读者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-import

[English](README.md) | 中文

## 概述

`dsh-context-import` 把在 Codex 或 Claude Code 中建立的对话带进 dsh。`/import` 列出配置根目录下的外部会话，随后二选一：用其中一个创建带种子历史的新会话，或把一份精简渲染注入你当前所在的会话。导入后的会话与任何其他会话一样持久化、恢复、分叉和渲染，因为整段对话都以普通事件进入持久日志。代价是外部历史本身：它进入上下文窗口，并在日志存续期间一直保留。

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

当在 Codex 或 Claude Code 中建立的对话需要在 dsh 内继续，且 dsh 主机可读取那些会话日志时，挂载本插件。

### 导入一个会话

`/import list` 打印配置根目录下所有可导入的会话。`/import codex <session-id>` 与 `/import claude-code <session-id>`（接受 `claude` 作为别名）用该对话创建带种子历史的新 dsh 会话，其 id 固定为 `import-<tool>-<foreign-id>`，因此重复导入同一个外部对话会落到同一身份，而不会散落多份副本。`/import --inject <tool> <session-id>` 则把该对话的一份精简渲染追加到你当前所在的会话。裸 `/import` 与 `/import help` 返回用法行；任何其他首词都返回错误结果。其他插件通过 `ctx.contextImport` 使用同样的能力：`list()`、`parse()`、`importNewSession()` 与 `injectIntoCurrent()`。

### 配置

最小挂载无需任何配置，每个字段都有默认值。根目录缺失或不可读不算错误：列表对该根目录报告无可导入会话。

```yaml
- name: '@deepseek-ai/dsh-context-import'
  config:
    claudeDir: /home/me/.claude/projects
    injectTailMessages: 4
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `codexDir` | `$CODEX_HOME/sessions`，否则 `~/.codex/sessions` | Codex rollout 日志的根目录。 |
| `claudeDir` | `$CLAUDE_CONFIG_DIR/projects`，否则 `~/.claude/projects` | Claude Code 项目日志的根目录，每个工作目录一个子目录。 |
| `codexIndexPath` | `$CODEX_HOME/session_index.jsonl`，否则 `~/.codex/session_index.jsonl` | 记录 CLI 自己给对话命名的 Codex 会话索引；索引缺失时回退到首个提示词。 |
| `provider` | 外部工具名 | 记录在导入历史上的提供方；显式配置会覆盖外部日志自身记录的提供方。 |
| `model` | `imported` | 记录在导入历史上的模型；显式配置会覆盖外部日志自身记录的模型。 |
| `injectTailMessages` | `8` | 注入 transcript 尾部逐字渲染的消息条数；更早的消息各压缩为一行。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-context-import)是每个受支持字段及其 JSDoc 的穷尽式真源。`injectTailMessages` 为负数或非整数时插件加载即失败，而不是降级渲染。

### 读取 Codex rollout

一个逻辑 Codex 会话横跨所有共享同一个 `session_id` 的 rollout 文件，因为压缩、恢复与分叉都会新开一个文件。导入按顺序读取这些分片并按 payload id 合并，因此写了两遍的条目只翻译一次；分片会先在给定文件自身位置所隐含的 `sessions` 与 `archived_sessions` 根目录下查找，然后才查配置的 `codexDir`。列表从 `codexIndexPath` 取对话名（`thread_name`，`updated_at` 最新者胜出），并回退到第一个真实用户提示词。`compacted` 记录会被记为一次跳过，压缩前的历史保留。Codex 会以 user 角色文本注入环境与指令前缀，因此 `<app-context>`、`<environment_context>`、`<recommended_plugins>`、`<heartbeat>`、`<image>`、`<turn_aborted>`、`<turn_context>` 与 `<user_instructions>` 都作为机器上下文被丢弃，而不会被当作此人说过的话重放。

### 读取 Claude Code 会话

Claude Code 在 `claudeDir` 下按对话顺序为每个会话写一个文件。`custom-title` 提供对话名与 transcript 标题，`summary` 提供摘要。工具结果出现在紧随其后的 user 记录中，以 `tool_result` 块的形式到达；解析器把它保留为独立条目，以便翻译器按 id 与调用配对。侧链、`thinking` 与 `image` 块，以及该 CLI 的非对话记录类型都不会在解析中保留。列表只读取每个文件的开头，因此 Claude Code 行以首个提示词命名，尽管完整解析会捕获该 CLI 自己的标题。

### 容错与失败

未知记录、未知内容块、畸形行、未配对的调用、孤立结果，以及同一个调用的第二个结果，都会连同原因被跳过，绝不导致导入失败；未配对与重复的调用和结果通过结果的 `dropped` 列表上报，`/import` 在结果文本中给出其计数。有两种情况反而会直接失败：方言不被任一解析器识别的文件，以及不含任何对话的日志。二者都会从 `parse()` 抛出，并在 `/import` 中表现为错误结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释插件的设计；可观察行为见[使用本包](#use-this-package)。

### 设计理念

两种方言共用一个翻译器，因为它们的日志形状相同：助手文本消息、工具调用（Codex `function_call`、Claude Code `tool_use`）与工具结果（Codex `function_call_output`、Claude Code `tool_result`）。每个解析器把各自的格式读入与厂商无关的 `ForeignTranscript`，翻译器再把它变成连续种子：一轮——从一条用户消息到下一条——变成一个 turn 的一个 step，调用在轮内按 id 与结果配对，而外部日志从未给出结果的调用会同时从助手消息内容与 `tool/call` 记录中消失。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`/import` 命令、`contextImport` 服务、注入渲染 |
| [`src/discover.ts`](src/discover.ts) | 根目录默认值、会话列表、方言识别、Codex 分片解析 |
| [`src/codex.ts`](src/codex.ts) | Codex rollout 解析器 |
| [`src/claude.ts`](src/claude.ts) | Claude Code 会话解析器 |
| [`src/translate.ts`](src/translate.ts) | 把外部 transcript 翻译为连续的会话种子 |
| [`src/jsonl.ts`](src/jsonl.ts) | 流式 JSONL 读取与记录字段读取 |
| [`src/types.ts`](src/types.ts) | 两个解析器共享的、与厂商无关的 transcript 类型 |

### 主要流程

`/import <tool> <id>` 从 `list()` 解析出对应行，解析并翻译该文件，再把种子交给 `ctx.agents.create`，由它以 `import-<tool>-<id>` 发布新会话；Web 对话框读取同一个 `list()`。文件按行流式读取，因为外部日志可达 GB 级；列表在每个文件的开头处停止，因此识别并为会话命名从不读取整个日志。种子自 seq 0 起连续，每个 turn 与 step 括号都闭合，并在会话发布前由 `Session.create` 校验。`injectIntoCurrent` 复用同一次解析，但改为追加一条带插件自身 `recall` 来源的 `user/message`，而不创建会话。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定不够用时阅读以下页面。它们从相邻的 context 包进入浏览器界面与生成的配置。

- [context 组地图](../README.zh.md)——相邻的请求上下文包。
- [Web 导入对话框](../../client/ui-context-import/README.zh.md)——基于 `/import list` 的会话头部动作与对话框。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-context-import)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 导入的会话历史

#### 模型看到的内容

导入的会话通过常规请求组装重放外部对话：同样的用户与助手消息、同样的 `tool-call` 内容块与工具结果，以及一条记录外部提供方与模型的 `request/header`。请求中没有任何标记表明这段历史是导入的。

#### Token 影响

整段外部历史进入导入会话的请求，并在日志存续期间一直保留。导入本身不添加摘要或框架文本，因此这些 token 就是外部消息加上它们之间的调用与结果。

#### KV Cache 影响

导入区域只写入一次、此后不再改写，因此构成稳定的请求前缀，后续追加只是延长它，不会使其失效。

### 注入到接收会话的 transcript

#### 模型看到的内容

`/import --inject` 向接收会话追加一条 user 角色消息：日志记录了外部摘要或标题时先放它，随后在尾部之前每条消息各占一行 `- <role>: <title>`，最后是最近 `injectTailMessages` 条消息，以 `<role>: <text>` 逐字呈现。

#### Token 影响

每次注入一条消息。压缩后的头部按每条更早的外部消息约一行计费，逐字尾部则完整计入这些消息，因此 `injectTailMessages` 是权衡上下文与保真度的旋钮。

#### KV Cache 影响

仅追加：该消息接在持久历史末尾，不改写任何更早的请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明何时不该使用导入，或需要格外注意。它们是当前包约束。

- **整段历史都会被导入**——导入时的 token 预算削减已延期，因此新建会话的导入会携带整段外部对话；一次导入最多保留前 20,000 条外部条目，超出该上限的条目会离开种子且不出现在 `dropped` 中。
- **外部格式不是稳定契约**——方言一旦变化就不再匹配其解析器，因此导入会直接失败，而不会把陌生的日志当作对话来读。
- **Claude Code 列表行以首个提示词命名**——`/import list` 只读取每个文件的开头，因此该 CLI 自己的 `custom-title` 会进入 `importNewSession` 的结果，却永远不会进入选择行。
- **时间戳回退到导入时钟**——外部记录没有时间戳时，由导入按外部顺序打上时间戳，因此消息顺序得以保留，而该消息的挂钟时间变成导入时间。
- **被丢弃的元素只上报、不修补**——未配对的调用、孤立结果，以及同一个调用的第二个结果都会离开种子；导入从不凭空补出配对的另一半。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包在其源码于版本控制之外被删除后，依据 Agent Note 与幸存下来的端到端夹具重建。解析器与翻译器测试套件覆盖两种方言、畸形行、未知记录、未配对调用与重复结果；真实 Loader 的端到端驱动（[`context-import-driver.ts`](../../../examples/headless-agent/tests/fixtures/context-import/context-import-driver.ts)）通过 headless 组合导入一个夹具。

</details>

**运行时不变式：** 不发布伴生入口。本包不持有可供独立观察的运行时关系：每次导入都是对它读取的文件做一次解析与一次翻译，它产出的持久状态属于 `ctx.agents.create` 发布的会话或它追加到的会话，而每次列表都从根目录重新派生。
