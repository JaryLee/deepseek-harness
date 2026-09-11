---
description: "dsh Web 客户端的 token 用量与费用展示：composer 旁的会话费用行，以及按模型、按提供方峰谷费率计价的单回合费用徽标。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cost-meter

[English](README.md) | 中文

## 概述

面向 Web 客户端的 token 用量与费用展示。浏览器半侧基于产生这些用量的模型路由以及提供方的峰谷时段，对持久的提供方用量计价，并渲染两处界面：composer 旁的会话费用行和每个已结束回合尾部的费用徽标。Node 半侧为空——计价在浏览器端从持久日志推导，没有需要归属的 Host 侧状态，也没有任何面向模型的输入。随附的 Web patch 是加载本包的唯一组合；移除其唯一一条 cordis.yml 条目即可同时移除这两处界面。

## 目录

- [如何计价](#how-it-prices)
- [Model Experience（模型体验）](#model-experience)
- [Known Limitations and Deferred Work（已知限制与待办）](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="how-it-prices"></a>
## 如何计价

harness 从不记录费用。本插件由提供方上报的 token 数、每模型费率表以及提供方的峰谷时段计算费用。两处界面都把每个 assistant 步骤按产生它的模型、并按该步请求时刻生效的峰值或空闲费率计价：单回合徽标把已结束回合的步骤求和，会话费用行把已加载对话窗口内的每个 assistant 步骤求和，因此费用行等于各徽标之和。费率表中没有条目时，不显示费用而不是猜测。

费率表是内置参考，存放公开的**峰值**费率（每百万 tokens 的人民币；每个值是 `{ input, output, cacheRead, cacheWrite }`，可选带同名字段的显式 `offPeak` 费率），再与插件 cordis 配置里可选的 `pricing` 映射合并。官方价目只列三项——缓存命中输入、未命中输入、输出——因此 `cacheWrite` 沿用本包"等于未缓存输入费率"的惯例；在 DeepSeek 自身路由上没有任何适配器上报缓存写入桶，该字段在那里不参与计价。峰值时段取提供方排期（工作日 UTC 01:00–04:00 与 06:00–10:00，周末全天按空闲），并可通过 `peakWindows`（UTC 当日分钟）与 `offPeakFactor`（模型未声明显式 `offPeak` 费率时对其峰值费率施加的倍率，默认 `0.5`）覆盖；`currency` 键设置显示符号（默认 `¥`）。浏览器客户端插件经由其启动图行读取这些字段，该行原样携带 Loader entry 的 config；改动配置需重建 entry 并重新加载页面。

`costOf` 按桶应用单一计费公式：未缓存输入、缓存读取、缓存写入、输出，各自按各自费率。`normalizeUsage` 读取单步提供方 `TokenUsage` 采样；`ratesAt` 为某一请求时刻选出峰值或空闲费率，`billedAt` 从步骤记录的起始时间取该时刻、缺失时退回其完成时间。`formatTokens` 与 `formatCost` 生成紧凑展示。本插件的两个组件只在能给一个值计价时才渲染，因此使用了未知模型的会话或回合保持静默——但费率表以路由记录的确切模型 id 为键，更名或新增的 id 会让两处界面变空且看不出原因。因此每个无法计价的 id 会按页面各上报一次 `console.warn`，指明需要补充的 `pricing` 键。

<a id="model-experience"></a>
## Model Experience（模型体验）

### 用量与费用表（纯 UI）

#### 模型看到什么

没有新增内容。本插件只通过 `ctx.slots` 注册展示，不增加系统提示段、工具 schema 或任何面向模型的输入；它只读取模型已经产生的持久对话与提供方用量。

#### Token 影响

双向为零。本插件既不额外发送提示上下文，也不改变请求信封；费用与 token 数字均在客户端从既有持久数据推导。

#### KV Cache 影响

无。没有增加任何提示前缀或改变缓存形状的文本；这两处界面只是对已缓存请求状态的纯呈现。

## Known Limitations and Deferred Work（已知限制与待办）

<a id="known-limitations-and-deferred-work"></a>

- **两处界面都受窗口限制。** 会话费用行把已加载对话窗口内的 assistant 步骤求和，回合徽标读取该窗口内的步骤，因此被翻页或压缩移出窗口的回合不再向二者贡献数字。费用行按构造等于各徽标之和，而不是持久的全量日志总量。
- **峰谷以请求时刻为准。** 每个步骤用其记录的起始时间选择时段；该值缺失时退回完成时间，因此两个可观测时刻跨越边界的请求，按其中存在的较近者计价。
- **行的配置以 JSON 跨越协议层。** 只有当 Loader entry 的 config 属于浏览器平面数据时，启动图的行才会携带它，因此本插件的配置必须是纯 JSON 数据：`!!js` 表达式属于该行的宿主半、会被保留不投递，函数、`undefined`、symbol 会在往返中消失，`Date` 变成字符串，`Map`/`Set` 变成空对象，而无法序列化的值会立即让组合报错。改动配置需重建 entry 并重新加载页面。
- **内置费率与时段是参考，不是契约。** 默认条目存放当前公开的 DeepSeek 峰值费率与公开时段，只应作为按部署核对的起点；本插件不发起任何取实时价格的网络请求。
- **价格表中没有的模型不显示费用。** 这是刻意为之——不为未知模型显示任何估算或推断价格。增加一个模型只是配置改动。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布配套件。本包不持有可变状态：字典与两处插槽注册均由 effect 持有，其销毁已由本包 spec 证明。
