# Agent Note: Web GUI 的桌面完成与提问通知

Status: implemented

[English](2026-09-02-desktop-completion-notifications.md) | 中文

## Problem

Web GUI 在窗口最小化或切换到其他标签页时，会话完成没有任何提示：几分钟的后台任务只能靠用户轮询或侧边栏的绿点。同样的缺口也存在于会话等待用户时——问题、方案确认或审批在最小化窗口后面挂起数分钟。Codex 与 Claude Code 都在完成时弹系统通知；dsh 没有等价物。修复不能刷屏——running→idle 边沿同样出现在目标轮次、排队轮次与恢复之间——不能为子代理完成提醒（父轮次才是用户可见单元），但仍要为子代理提问提醒，因为任何待处理交互都在阻塞整个运行等你回应。

## Decision

`@deepseek-ai/dsh-client-desktop-notify` 作为 opt-in 客户端插件随 `dsh-web-app` bundle 发布。其 Node 半注册 `desktop-notify` 设置命名空间（`enabled`、`onlyWhenHidden`、`onQuestion`、`sound`、`quietMs`）；浏览器半为每个顶层会话完成、每条待处理交互播报一条通知，并在插件配置 slot 下注册设置卡片、在 shell overlay 座位下注册页面内提示。

引擎是注入端口上的纯逻辑。它消费转发的 `api-session/status` 流；每个会话的首次观察只记录 running 位（页面加载与重连回放不能误报），观察到的 running→idle 边沿启动 `quietMs` 定时器（默认 1500 ms），之前的 false→true 边沿取消它——这就是目标轮次与排队轮次的抑制器。设置 `enabled`、权限 `granted`（仅系统通知面需要）、可见性与可播报性（子代理的完成属于调度它的父轮次，其提问不属于）决定这一次播报。列表快照在挂载与 `connection/reset` 时给引擎播种，因此页面加载时已在运行的会话仍能在完成时触发；播种只是快照，绝不构造边沿，而列表行未知的会话仍算可播报，因为它的行可能只是还没到。

引擎还镜像客户端的待处理交互快照（`uiSession.pendingInteractions`）——GUI 正在等什么的对象层记录——因此不必加入 `user-questions/request` 或 `approval/request` 远端瀑布，后者的监听链被展示插件抢占，任何观察者都无法保证排序。挂载时已在等待的交互播报一次（页面启动阶段到达的提问不能被当成回放吞掉）；其后出现的交互立即通知（没有安静窗口——运行阻塞在回答上），每条交互 key 一次，已回答的交互清除标记使下一条重新通知。kind 选择文案（`notify.waitingAnswer` / `notify.waitingApproval` / `notify.waitingPlan`）；子代理会话也会通知，因为其提问同样阻塞在你身上。

播报按页面状态分流：不可见页面弹系统通知，可见页面把页面内鲸鱼提示渲染进 `shell.overlay`（一整个扁平插画场景，没有任何矩形边框——一团淡入应用的天空辉光、会向左缘与深处淡出的波浪剪影、围绕一条固定水线绘制的水花，以及下方持续流动的海面；同一只鲸鱼的两份裁剪副本共用一段跃起动画，水线之下的那份在水体色调与焦散下变模糊、变暗，水线之上的那份干爽并打光；最高点让头部留在画布内、尾部仍在水里；会话标题与状态文案装在水泡里停留七秒；`prefers-reduced-motion` 下静态呈现）。开启 `sound` 时，可见页面还会播放 Web Audio 合成音——带回声的长鲸鸣、破水的水花与气泡尾音、两声海鸥叫，不随包发布音频素材；不可见页面则由系统通知携带系统提示音。只有关闭 `onlyWhenHidden` 时才同时再弹系统通知。页面内提示不需要浏览器权限，因此 Notification API 被拒绝或不支持时照常显示。系统通知携带品牌标识作为 `icon`——由官方几何在 DeepSeek 品牌蓝里栅格化并逐页缓存，canvas 不可用时回退到外壳 favicon；Windows 会以站点图标覆盖该字段。

展示内容从会话列表行解析：通知用 `displayTitle` 指认会话——列表行还没到时用一条通用等待文案指认——第二行文案由浏览器半自己的字典给出，每个状态一条（`notify.finished`、`notify.waitingAnswer`、`notify.waitingApproval`、`notify.waitingPlan`）。点击通知会聚焦窗口并打开该会话。设置卡片通过标准客户端 settings scope 读写命名空间，并在卡片自己的控件上发起浏览器权限请求——授权必须来自用户手势；请求被拒时保持当前状态，使后续重试仍可成功，API 不存在（非安全上下文）时在卡片上报告 `unsupported`。

## Alternatives considered

**总是通知、不设安静窗口** —— 拒绝。目标轮次会每轮弹一条 toast；安静窗口把它们折叠为一次用户可见的完成。

**宿主侧 OS toast（`node-notifier`）** —— 就 Web GUI 拒绝。宿主进程无法感知「页面是否最小化」，而这正是需求的一半；浏览器的 Notification API 给出同样的 OS toast 且知道可见性状态。宿主侧通知仍作为独立的 CLI/headless 可能保留，此处记作超范围。

**挂接 `user-questions/request` / `approval/request` 远端瀑布** —— 拒绝。两者都是被展示插件领走的瀑布链，注册在领走者之后的观察者永远不会运行；待处理交互快照才是已定的、与顺序无关的信号。

**React `useSyncExternalStore` 卡片状态** —— 拒绝。卡片状态从设置 scope 加一个浏览器权限字符串派生，不是跨入口共享事实；快照 store 句柄与其他插件卡片一样经 slot 的 inject hooks compartment 提供给组件。

**可见页面复用共享的纯文本 `Toast`** —— 拒绝。该控件是由 owner 控制、顶部居中的文本横幅；本次要的表面是品牌标识的一跃、并以会话作为点击目标，因此本包自持一个带动画的 overlay 条目，而 `FISH_LOGO_PATH` 正是为这种组合导出的几何。

**以 `turn/end` 而非 running 状态为信号** —— 拒绝。`turn/end` 在目标轮次之间也会触发，且不含「下一轮」信息；running 位加安静窗口是唯一已携带「没有已排程工作」的信号。

## Consequences

GUI 获得 Codex 风格的 toast，且每个会话以 OS 级 `tag` 去重（后续 toast 替换同一会话的旧 toast），并新增提问 toast——运行阻塞在用户时立即到达——以及可见页面的鲸鱼提示。功能是 opt-in，不会惊吓现有用户。它依赖浏览器保持打开——关闭标签页即结束通知——系统通知面还依赖安全上下文，卡片上已注明；页面内提示两者都不需要。安静窗口按会话计，所以恢复会话若下一次运行在 `quietMs` 之后才开始仍会多出一条 toast；N 个会话完成时弹出 N 条；提问 toast 每条交互一条。列表行尚未到达页面时观察到的完成会随列表变化重试，四次后放弃，因此始终不来的行不会留下通知。插件不追加任何会话事件：模型可见与持久化内容均无变化。

## Verification

引擎 spec 钉住边沿检测、首次观察播种、安静窗口取消、子代理完成的可播报性过滤、按 key 的提问去重、隐藏/可见分流、免权限的页面内通道，以及列表行到达后的重试与上限；设置与权限 spec 钉住线路解码器与无需手势的权限读取；卡片与 controller spec 钉住 scope 桥接、权限手势流程与释放；whale store spec 钉住保持窗口、替换、消失与释放，提示 spec 钉住渲染的标识、文案、点击打开与关闭；音效与图标 spec 钉住挂起上下文的跳过、合成图与栅格化的品牌标识及其 favicon 兜底；apply spec 用 Notification double 端到端驱动转发的 `api-session/status` 流与待处理交互快照（toast 构造与品牌图标、点击打开、kind 文案、构造失败遏制、重连重新播种、子代理抑制），并覆盖两处注册与其页面内提示。每个 `src` 文件保持逐文件 100% 覆盖。
