# Agent Note（代理注记）：客户端插件配置经由启动图投递

状态：已实现（implemented）

[English](2026-09-10-client-plugin-config-delivery.md) | 中文

## 问题

浏览器客户端插件由宿主注入为 `window.__DSH_BOOT__` 的启动图在浏览器里组合。图中每一行只携带模块到达相关的事实——id、URL、版本、`inject`、`immediately`、`external`——因此 Loader entry 的 `config` 从未跨越协议层：`apply(ctx, config)` 什么也收不到，客户端插件声明的每个配置字段都不可达。Web token 与费用表是可见的实例：它的 `pricing`、`currency`、`peakWindows`、`offPeakFactor` 无法从 cordis.yml 设置，于是部署无法为随包表未列出的模型定价，而它的文档描述了一条并不存在的配置路径。

## 决策

让每一行的 config 经由启动图投递。

- `WebBootEntry` 增加 `config?: unknown`。宿主在把某个包并入自己的表时原样复制 Loader entry 的 `config`，并在 HMR 重建该行时重新应用保留的值。`null` config（即写成空 `config:` 的行解析出的值）在两个边界都被视为"无"，因为客户端插件的 `apply(ctx, config = {})` 默认参数覆盖不了 `null`。
- config 参与组合的来源键（source key），因此一次扫描若观察到不同的 config，就会组合出不同的行；由于图版本哈希各行，图修订号也会变化。该值在解析来源时读取：仅改配置不会重建 Loader entry，所以运行中的 entry 保持它被组合时的配置，而启动图是页面的初次加载记录。要让改后的配置生效，需重建 entry 并重新加载页面，而不是实时 patch 重载。
- 启动 manifest 解析器只把 `config` 复制进插件视图。模块表只负责取 bundle，不需要 config，因此 `BootModuleRow` 不变，协议层保持最小。
- 启动内核把它传给 `loader.create({ name, config })`，浏览器 Loader 随后在浏览器自身上下文中插值该值，与宿主行完全一致。只有属于浏览器平面数据的 config 才会被投递：`!!js` 表达式是针对拥有该行的 Loader 上下文写的——在随附 Web profile 里就是宿主上下文——因此宿主保留不投递，而不是让浏览器拿它去求值浏览器并不具备的服务。出货的 `connection` 行正是这样一行：它是双面包，其 `!!js` config 供宿主半使用，原样投递会让该 entry 被拒绝并拖垮整个启动。

## 备选方案

- **启动后经宿主服务或 Remote 调用投递配置** —— 否决。它引入第二条配置路径、激活与投递之间的顺序问题，以及在启动图已覆盖所有其他行事实的面上新增失败模式。
- **在宿主侧解析 `!!js` 并投递已解析值** —— 否决。它要求该行的 fiber 已解析出配置，而扫描不能这样假定：`inject` 等待宿主服务的行会更晚解析，于是投递的值取决于激活顺序。它还会把双面包行的宿主配置交给它的浏览器半。保留不投递只留一条规则，且不依赖顺序。
- **把配置序列化进插件 bundle** —— 否决。配置是部署数据，不是产物内容；固化进去会让产物哈希随部署变化，并破坏不可变 bundle 缓存。

## 后果

客户端配置值必须经得起 JSON，因为图会被序列化进页面：无法序列化的配置会带行名立即报错，而不是组合出一个无法作键的来源；非 JSON 的叶子值会退化——函数、`undefined`、symbol 消失，`Date` 变成字符串，`Map`/`Set` 变成空对象。含 `!!js` 表达式的 config **保留不投递**：它属于该行的宿主半，浏览器 Loader 会拿它去求值浏览器并不具备的服务，从而拒绝该 entry 并拖垮整个启动。一次扫描若看到不同的 config，会组合出不同的行并提升图修订号，但让它生效需重建 entry 并重新加载页面。没有改动 Session 格式、事件或投影形状。覆盖：解析器 spec 钉住插件视图携带 config、省略 null 值，且模块视图不受影响；node 半 spec 钉住浏览器平面的 config 抵达组合行、宿主平面的被保留、无法序列化的带行名报错，且一次看到变更的扫描会重建该行；启动 spec 钉住插件的 `apply` 会收到它。
