# Changelog

## [1.3.0] - 2026-07-16

`fd231be`

### Added
- 导入 CloudSync 作为独立模块，检测 ChatGPT 会话是否在其他设备更新
- 通过 WebSocket 事件驱动判断本地/远端消息，零轮询
- 会话过期后 3 秒自动刷新页面（可关闭）
- Popup 集成 CloudSync 状态显示和 Auto Refresh 开关
- Logo Badge Dropdown 同步 CloudSync 状态和 Auto Refresh

### Internal
- CloudSync 文件独立存放于 cloudsync/ 目录
- background 拆分为 background/monitor.js + background/cloudsync.js
- Manifest 新增 CloudSync content_scripts（MAIN + ISOLATED）
- content.js 新增 storage 读取桥接接口

---

## [1.2.3] - 2026-07-15

`32248cf`

### Fixed
- 适配 ChatGPT conversation SSE 新格式：新增 delta/server_ste_metadata 事件类型，字段名从 resolved_model_slug 变为 model_slug
- delta 事件的 v.message.metadata.model_slug 作为最高优先级
- server_ste_metadata/metadata 仅在 delta 未提供时补充
- 日志区分无模型字段和有字段但未解析到，减少误判

---

## [1.2.2] - 2026-07-13

`aff74c7` `df68688` `0c28978`

### Added
- 使用统计面板：近 1h/3h/24h 消息频率统计
- 额度恢复预测（+1/+10/全部恢复剩余时间）
- 模型活跃追踪（最近活跃时间）
- 无模型时默认渲染 GPT-Monitor 徽章
- 监听 SPA 路由变化自动恢复徽章

### Changed
- Popup 与 Dropdown 布局优化，适配新统计面板
- 使用限制面板补充恢复预测说明

### Removed
- modelHistory 的 lastActive 字段，统一使用 messageTimestamps 计算活跃时间

---

## [1.2.1] - 2026-07-01

`b30f18a` `c595a41` `f2669f5` `99579f4`

### Added
- README 添加 😺 图标

### Changed
- 模型轮数（turns）由 updateModel() 实时维护，不再依赖 messageTimestamps 计算
- Popup 当前模型持续时间改用实时计算
- Popup ⓘ 使用限制改为内联替换，与 Dropdown 一致

### Removed
- ⓘ 使用限制 Modal 弹窗
- recordMessage() 中冗余的轮数计算

---

## [1.2.0] - 2026-06-29

`f1c1be3` `97da4a5` `a28e89b` `6e61c70` `9c2d562` `5e812e8`

### Added
- 模型切换历史记录新增持续轮数（turns）和持续时长（duration）字段
- 当前模型卡片展示：模型名、轮数、时长、开始时间
- 新消息到达时自动刷新已展开的下拉菜单
- 使用限制面板新增「额度是逐条恢复，不是到点重置」提示

### Changed
- popup 和 dropdown 统一为卡片式布局，当前模型与历史记录分离
- 清除功能合并为单一按钮，同时清空消息统计、历史记录和模型状态
- 持续时长小于1分钟显示为「<1分钟」

### Removed
- 独立的消息计数清零按钮
- 状态行（状态指示灯、已降智/正常文字、切换次数）
- 近24h统计旁的「(参考)」标记
- 未使用的 CSS 样式

### Docs
- 新增 CHANGELOG.md
- 更新 README 描述和预览图片
- README 格式调整

### Internal
- 移除未使用的 CSS 类定义

---

## [1.1.0] - 2026-06-27

`fc71a69` `b77e30a`

### Added
- Logo 按钮旁模型徽章，点击展开历史下拉菜单
- 消息计数徽章（近3h / 160）
- 每条 AI 回复旁的模型名称标签
- 扩展启动提示条
- 浏览器控制台调试接口 `window.__modelMonitor`

### Fixed
- 连续收到同模型 SSE 推送时横幅闪烁的问题
- Tab 刷新后重复注入导致的多份横幅
- 扩展弹窗最小化后再打开时徽章丢失的问题
- SSE 数据中 `resolved_model_slug` 位于深层对象路径时的解析失败
- 异步 storage 操作之间的竞争条件

### Changed
- 模型切换横幅降智模型5秒、正常模型3秒自动消失
- 降智模型徽章启用红色脉冲动画并触发系统通知
- 历史记录最多保留50条

### Docs
- README 补充背景故事和使用场景说明

---

## [1.0.0] - 2026-06-26

`38c84af` `62874a8` `87767c0` `6dc2563` `301dd7a`

### Added
- Manifest V3 扩展框架
- 通过 `webRequest` 拦截 ChatGPT 会话请求
- 拦截 SSE 流提取后端实际路由模型（`resolved_model_slug`）
- 根据模型 slug 是否包含 `mini` 判断降智状态
- 模型切换横幅提示（降智红色、正常绿色）
- 降智时弹出系统通知
- popup 弹窗展示当前模型和历史切换记录
- 24 小时滚动消息计数
- 页面主世界注入（`world: MAIN`）拦截 fetch 解析 SSE
- content script 与 storage 的跨世界通信桥接

### Docs
- 扩展说明 README（中英文）
- 示例图片
