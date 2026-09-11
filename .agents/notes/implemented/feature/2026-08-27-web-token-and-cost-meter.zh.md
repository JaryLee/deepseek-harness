# Agent Note（代理注记）：Web token 与费用计费器——基于持久提供方用量的客户端定价

状态：已实现（implemented）

[English](2026-08-27-web-token-and-cost-meter.md) | 中文

## 问题

Web 客户端已经展示持久的 token 数（聊天统计条读取 `tokenUsage`，每条消息 footer 也携带简短的用量数字），但不展示任何金钱费用。harness 从不记录费用——`llm-pi-ai` 的 `replay.ts` 会将提供方的费用元数据清零，也没有任何消费方读取它——因此"这条对话花了多少钱"在 GUI 中无从回答。用户希望在每条回复处和会话总量处展示费用，并按所选模型的官方价目表计价。

## 决策

新增一个纯客户端插件 `@deepseek-ai/dsh-client-ui-cost-meter`，从它本就读取的持久提供方用量推导费用，并渲染两处界面。Node 半侧为空：计价是仅客户端、基于已记录数据的推导，没有 Host 侧状态，也没有任何面向模型的输入。将本插件从 cordis.yml 中组合出去即可同时移除这两处界面。

### 一个计费公式，一种归一化

`costOf` 按各自费率对每个桶计价（每百万 tokens 的未缓存输入、缓存读取、缓存写入、输出，人民币）。`normalizeUsage` 读取单步提供方 `TokenUsage` 采样（`inputTokens`）。`formatTokens`/`formatCost` 生成紧凑展示；组件只在能给一个值计价时才渲染，因而未知模型保持静默而不是猜测。峰谷费率选择由[峰谷 Agent Note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.zh.md) 拥有。

### 会话总量：composer 停靠行

`TotalCost` 注册进 `conversation.composer.dock`（id `cost`，order 1，位于统计条之后）。它现在把已加载窗口内的 assistant 步骤求和，各自按其模型与峰谷时段计价，因此费用行等于各徽标之和；[峰谷 Agent Note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.zh.md) 拥有该决策以及它放弃的抗翻页性。

### 单回合徽标：turn-tail 链

`TurnCost` 注册进 `conversation.chat.turnTail`，并通过与交付物行相同的 `TurnTailOwnerProps` 货币读取引擎持有的结束回合：它对该回合每个 assistant 步骤的用量求和（经 `turn.steps` 的 `assistant-step` 数据），并按每个步骤各自的 `finalNode.provenance.model` 以及其请求时刻生效的峰谷费率计价，因此一个在步骤间切换模型的回合会按步骤分别计费。它的 token 总数统计每个步骤的可用用量，因此与旁边的「本轮用量」展示一致；费用只反映能计价的步骤。选择器在没有步骤可计价时于挂载前拒绝，因此徽标只对能计价的回合出现。它受窗口限制：被翻页或压缩移出窗口的回合不渲染徽标，而自[峰谷 Agent Note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.zh.md) 起会话费用行同样如此。

### 价格表：内置参考 + 配置覆盖

价格表是默认路由公开峰值费率的模块常量，再与插件 cordis 配置里可选的 `pricing` 映射合并，并有 `currency`、`peakWindows`、`offPeakFactor` 键；[峰谷 Agent Note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.zh.md) 拥有排期。这遵循"不硬编码可调项"规则：价格随部署变化，因此可配置；而内置条目只是文档化的外部规范起点，部署需核对并覆盖（官方价格会变化）。

## 备选方案

- **Host 记录费用（持久 cost 投影）**——准确且按模型，但需改动 `llm/token-meter` 及其投影测试，并在用量采样上增加分模型成本拆分。推迟；客户端推导能覆盖常见的单模型用例。
- **把单步成本写入会话日志**——违反"模型可见⟺已记录"这一针对模型从不产生的值的约束；费用是派生的 UI 数字，不是模型可见输入。
- **扩展现有 `StatsLine`**——会把本插件的定价策略耦合进 `ui-conversation`，并使移除变成核心改动；而 dock 槽位本就是列表，注册一行兄弟即可保持一处 cordis.yml 条目即可移除。

## 后果

两处界面现在都受窗口限制，并自[峰谷 Agent Note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.zh.md) 起按构造一致，因此二者都不再扛过分页与压缩。没有改动任何快照、事件或投影形状，因此没有既有期望输出移动；本插件自身测试覆盖了纯推导、两个渲染器以及槽位注册的 fiber 销毁移除，且 `verify-client-packages` / `verify-cordis-config` / `verify-package-invariants` 通过。
