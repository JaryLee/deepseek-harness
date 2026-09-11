# Agent Note（代理注记）：从 Codex 与 Claude Code 会话日志导入上下文

状态：已实现（implemented）

[English](2026-08-27-context-import.md) | 中文

## 问题

用户在多个编码 CLI 之间来回切换，而他们在 Codex 或 Claude Code 里积累的对话不会随之迁移；dsh 此前只能从零开始，或 fork 自己的会话。导入的历史必须作为一等会话事件写入持久会话日志——"模型可见 ⟺ 已记录"这条不变量禁止注入未记录的文本——并且外部工具调用的结构应当保留，使导入的对话回放起来与 dsh 自己产生的对话无异。

## 决策

`@deepseek-ai/dsh-context-import` 把 Codex 会话日志（`~/.codex/sessions/<month>/<rollout>.jsonl`）与 Claude Code 会话日志（`~/.claude/projects/<encoded-cwd>/<session>.jsonl`）解析为提供方无关的 `ForeignTranscript`，再将其翻译成一段连续的 dsh 会话种子：成对的轮次/步骤括号，带 surface 标记的 `user/message`、`assistant/message`、`tool/call`、`tool/result` 事件，以及一条携带外部提供方/模型身份的 `request/header`。该种子经 `ctx.agents.create({ seed })` 流入，因此导入的会话与其它会话一样持久化、恢复并回放。

两种方言共用同一个翻译器，因为它们的日志形态相同：assistant 文本消息、工具调用（Codex 为 `function_call`，Claude Code 为 `tool_use`），以及工具结果（Codex 为 `function_call_output`，Claude Code 把 `tool_result` 放在其后的 user 记录中）。翻译以轮次为单位进行——一个轮次从一条 user 文本消息开始，到下一条消息为止——并在轮次内按 id 把调用与结果配对。被中断会话中未配对的调用会同时从 assistant 消息内容和 `tool/call` 记录中丢弃，并通过结果中的 `dropped` 列表报告；没有前置 assistant 步骤的结果载体作为孤儿丢弃。

外部格式不是稳定的公开契约。两个解析器都是宽容的：未知行与未知内容块会被跳过并给出原因，绝不致命；若某文件的方言两个解析器都不认识，则退化为空 transcript，随后由导入显式失败。思考 transcript、side chain、system 行、图片，以及 Claude Code 的非对话记录类型（`attachment`、`last-prompt`、`custom-title`、`mode`、`queue-operation`）都不会在解析中保留；文件的汇总摘要与工作目录则作为来源信息保留。

导入有两种模式。`importNewSession` 创建一个以翻译后的历史为种子的新 agent（部署的默认预设会在名册存在时组合它）；`injectIntoCurrent` 把精简后的渲染以 `recall` 形式的上下文注入接收 agent 的下一次请求——头部压缩为每条消息一行，尾部在 `injectTailMessages` 之内保持逐字。`/import` 命令是人类入口（`/import list`、`/import <codex|claude> <session-id>`、`/import --inject …`）。

## 备选方案

**用一个 skill 教会模型自己读 JSONL 文件**——为真实能力而否决。模型每次使用都要重新解析，反复消耗 token，丢失工具调用的结构，并产生不确定的种子；而插件只翻译一次，过程确定，且有测试覆盖。

**为导入新增一种会话事件类型**——首个版本否决。插件来源的 `user/message` 上的 `recall` 上下文形式，加上携带外部提供方的 `request/header`，已经让导入可重建；专门的事件会要求一次格式版本机制评审，而当下并没有消费方。

**在导入时削减 token 预算**——推迟。新建会话的导入会携带整段历史；削减策略需要真实的 token 模型，已记录在「已知限制」下。

## 影响

导入的对话在日志中与 dsh 自己产生的对话无法区分，因此持久化、恢复、fork 以及 Web GUI 都能渲染它而无需特例。宽容规则意味着外部格式变化会显式失败（导入为空），而不是静默误读历史。`injectIntoCurrent` 绝不注入没有文本内容的 transcript，其标题行也只在对应段落有内容时才渲染。

## 验证

基于 fixture 的解析器测试套件覆盖两种方言，外加畸形行、未知类型、未配对的调用与静默记录类型；翻译器套件断言精确的事件序列，并证明每个种子都被 `Session.create` 接受且推导出预期的消息历史。一条真实 Loader 的 e2e 通过 headless `cordis.yml` 导入一个 fixture，并断言持久化后的日志。开发期间解析了开发机上的真实 Codex 与 Claude Code 会话文件，并通过 `Session.create` 接受（2,872 条消息与 339 条消息的会话）；fixture 文件是合成的，因此该套件可在任何环境回放。
