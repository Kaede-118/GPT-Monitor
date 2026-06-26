# GPT-Monitor

> 🚀 Chrome 扩展，实时监控 ChatGPT 当前使用的模型，并在切换到“降智”模型时发出醒目提醒。

![Version](https://img.shields.io/badge/version-1.3-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/license-MIT-orange)

---

## ❔ 为啥写这个

作者是 ChatGPT 重度用户，每天少说也聊个两三百轮，老被路由到 `mini` 模型。切到 `mini` 后代码质量直线下降，一度改坏自己的qq空间爬虫脚本，要求给出完整代码时，GPT顺手重构脚本并且“不小心”删除了核心模块和一些逻辑，幸亏备份了。所以——**早知道，早预防**。

---

## ✨ 功能特性

- **实时模型检测** — 拦截 ChatGPT API 的 SSE 数据流，提取当前使用的模型名称
- **视觉提醒** — 检测到模型切换时，顶部横幅 + 桌面通知
- **消息标记** — 每条 AI 回复自动标记所使用的模型
- **历史记录** — 最多保存 50 条模型切换记录，带时间戳
- **使用量统计** — 监控近 3 小时内的消息数量，帮助追踪 GPT-5.5 额度消耗
- **测试模式** — 一键切换显示样式，方便验证 UI 效果

---

## 📸 效果预览

| 正常模型（GPT-5.5） | 降智模型（mini） |
|-------------------|-----------------|
| 🟢 绿色横幅 + 绿色图标 + 桌面通知 | 🔴 红色横幅 + 红色图标 + 桌面通知 |

---

## 🛠️ 安装步骤

1. 克隆或下载本项目
2. 打开 Chrome → `chrome://extensions/`
3. 开启右上角的 **开发者模式**
4. 点击 **加载已解压的扩展**
5. 选择 `GPT-Monitor` 文件夹

---

## 🔬 测试方法

在 ChatGPT 页面打开控制台：

```js
window.__modelMonitor.setModel('gpt-5-5')      // 正常样式
window.__modelMonitor.setModel('gpt-5-3-mini') // 降智样式
window.__modelMonitor.test()                   // 两者间切换
window.__modelMonitor.status()                 // 查看当前状态
```

或点击扩展弹窗中的 **🔬 测试** 按钮。

> ⚠️ 测试模式**仅修改本地显示样式**，不会实际切换 ChatGPT 后端模型，仅用于调试和预览 UI 效果。

---

## 📁 项目结构

```
GPT-Monitor/
├── manifest.json      # MV3 声明、权限配置
├── background.js      # Service Worker，监听 webRequest，执行注入
├── content.js         # Storage 桥接（隔离世界）
├── popup.html         # 扩展弹窗 UI
├── popup.js           # 弹窗逻辑
├── AGENTS.md          # 开发笔记
└── icons/             # 16/48/128px 图标
```

---

## 🧩 工作原理

### 通信链路

```
ChatGPT 页面（MAIN 世界）
    │
    ▼ 拦截 /backend-api/... 的 SSE 数据
提取 resolved_model_slug
    │
    ▼ postMessage
content.js（隔离世界）— 桥接到 chrome.storage
    │
    ▼ chrome.storage.local
popup / background — 展示模型、历史、图标
```

1. **页面主世界** 拦截 ChatGPT 的 `fetch` 响应，提取 `resolved_model_slug`
2. 通过 **postMessage** 发送给 content script（隔离世界）
3. **content.js** 写入 `chrome.storage.local`
4. **Popup / background** 读取 storage，更新 UI

---

### 📡 接口信息

扩展通过拦截 ChatGPT 的对话接口来获取实际使用的模型：

| 项目 | 说明 |
|------|------|
| **接口** | `POST https://chatgpt.com/backend-api/f/conversation` |
| **响应** | `text/event-stream`（SSE 流） |

**请求体关键字段：**
```json
{
  "model": "gpt-5-5",  // 用户请求的模型（仅供参考，不可信）
  "conversation_id": "...",
  "messages": [...]
}
```

**响应中提取模型：**
```json
{
  "metadata": {
    "resolved_model_slug": "gpt-5-3-mini"  // ← 实际使用的模型
  }
}
```
> 备选路径：`v.message.metadata.resolved_model_slug`

**核心逻辑：** 请求中的 `model` 是用户选的，**不能信**；`resolved_model_slug` 才是后端实际路由的模型。扩展只读取这个字段来判断是否被降智。

---

### 🚦 模型判断规则

| 条件 | 状态 | 视觉反馈 |
|------|------|----------|
| Slug 包含 `mini`（不区分大小写） | ⚠️ 降智模型 | 红色横幅 + 桌面通知 + 红色图标 |
| 其他模型 | ✅ 正常模型 | 绿色横幅（3 秒淡出）+ 桌面通知 + 绿色图标 |

---

## 📊 存储结构

| Key | 类型 | 说明 |
|-----|------|------|
| `currentModel` | `string` | 最新检测到的模型名称 |
| `detected` | `boolean` | 是否已检测到模型 |
| `modelHistory` | `array` | 最多 50 条 `{ model, time, timestamp }` |
| `messageTimestamps` | `array` | 消息时间戳（保留 24 小时） |

---

## ⚙️ 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 持久化模型历史与状态 |
| `notifications` | 桌面通知 |
| `webRequest` | 检测对话 API 请求 |
| `scripting` | 注入 fetch 拦截器 |

**主机权限：** `https://chatgpt.com/*`

---

## 📝 注意事项

- 仅在 `https://chatgpt.com/*` 下生效
- 纯原生 JavaScript，无外部依赖
- 无构建工具 / TypeScript / package.json
- 测试模式的切换**仅影响本地 UI**，不改变后端模型

---

## 🐛 已知限制

- 依赖 ChatGPT 内部 API 结构，OpenAI 更改可能导致失效
- 历史记录上限 50 条
- 消息计数为滚动窗口，24 小时自动清除

---

## 🧑‍💻 开发调试

```bash
# 加载扩展
chrome://extensions/ → 开发者模式 → 加载已解压的扩展

# 修改代码后 → 扩展管理页点击刷新 → 刷新 ChatGPT 页面
```

---

## 📄 许可证

MIT


# GPT-Monitor

> 🚀 Chrome extension that monitors ChatGPT's current model in real time and alerts you when it switches to a "downgraded" (mini) model.

![Version](https://img.shields.io/badge/version-1.3-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/license-MIT-orange)

---

## ❔ Why This Exists

The author is a ChatGPT overdoser — hundreds of messages per day — and kept getting routed to `mini` models. Code quality tanks on `mini`; it once broke the author's QQ Space crawler script, and ChatGPT "accidentally" deleted core modules when asked for the full code. Thank goodness for backups. So — **forewarned is forearmed**.

---

## ✨ Features

- **Real-time model detection** — Intercepts ChatGPT API SSE streams to extract the actual model in use
- **Visual alerts** — Top banner + desktop notifications when model switches
- **Message labeling** — Each AI reply is automatically tagged with the model used
- **History tracking** — Stores up to 50 model switches with timestamps
- **Usage statistics** — Monitors messages in the last 3 hours to track GPT-5.5 quota consumption
- **Test mode** — One-click display toggle to preview UI states

---

## 📸 Preview

| Normal Model (GPT-5.5) | Downgraded Model (mini) |
|-------------------|-----------------|
| 🟢 Green banner + green badge + notification | 🔴 Red banner + red badge + notification |

---

## 🛠️ Installation

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `GPT-Monitor` folder

---

## 🔬 Testing

Open the console on ChatGPT page:

```js
window.__modelMonitor.setModel('gpt-5-5')      // Normal display
window.__modelMonitor.setModel('gpt-5-3-mini') // Downgraded display
window.__modelMonitor.test()                   // Toggle between them
window.__modelMonitor.status()                 // View current state
```

Or click the **🔬 测试** button in the popup.

> ⚠️ Test mode **only changes local display styles** — it does NOT switch the actual ChatGPT backend model. For debugging and UI preview only.

---

## 📁 Project Structure

```
GPT-Monitor/
├── manifest.json      # MV3 declaration, permissions
├── background.js      # Service Worker, webRequest listener, injection
├── content.js         # Storage bridge (isolated world)
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic
├── AGENTS.md          # Development notes
└── icons/             # 16/48/128px icons
```

---

## 🧩 How It Works

### Communication Flow

```
ChatGPT Page (MAIN world)
    │
    ▼ Intercepts /backend-api/... SSE data
Extracts resolved_model_slug
    │
    ▼ postMessage
content.js (isolated world) — bridges to chrome.storage
    │
    ▼ chrome.storage.local
popup / background — displays model, history, badge
```

1. **Page main world** intercepts ChatGPT's `fetch` responses and extracts `resolved_model_slug`
2. Sends via **postMessage** to content script (isolated world)
3. **content.js** writes to `chrome.storage.local`
4. **Popup / background** read storage and update UI

---

### 📡 API Endpoint

The extension intercepts ChatGPT's conversation API to get the actual model in use:

| Item | Details |
|------|---------|
| **Endpoint** | `POST https://chatgpt.com/backend-api/f/conversation` |
| **Response** | `text/event-stream` (SSE) |

**Request body key fields:**
```json
{
  "model": "gpt-5-5",  // User-requested model (for reference only, NOT reliable)
  "conversation_id": "...",
  "messages": [...]
}
```

**Model extracted from response:**
```json
{
  "metadata": {
    "resolved_model_slug": "gpt-5-3-mini"  // ← Actual model in use
  }
}
```
> Alternative path: `v.message.metadata.resolved_model_slug`

**Key insight:** The `model` in the request is what the user selected — **don't trust it**. `resolved_model_slug` is what the backend actually routes to. The extension only reads this field to determine if you've been downgraded.

---

### 🚦 Model Rules

| Condition | Status | Visual Feedback |
|------|------|----------|
| Slug contains `mini` (case-insensitive) | ⚠️ Downgraded | Red banner + notification + red badge |
| Other models | ✅ Normal | Green banner (fades out in 3s) + notification + green badge |

---

## 📊 Storage Schema

| Key | Type | Description |
|-----|------|------|
| `currentModel` | `string` | Latest detected model name |
| `detected` | `boolean` | Whether a model has been detected |
| `modelHistory` | `array` | Up to 50 entries: `{ model, time, timestamp }` |
| `messageTimestamps` | `array` | Message timestamps (last 24h) |

---

## ⚙️ Permissions

| Permission | Purpose |
|------|------|
| `storage` | Persist model history & state |
| `notifications` | Desktop notifications |
| `webRequest` | Detect conversation API requests |
| `scripting` | Inject fetch interceptor |

**Host permissions:** `https://chatgpt.com/*`

---

## 📝 Notes

- Only works on `https://chatgpt.com/*`
- Pure vanilla JavaScript, no external dependencies
- No build tools / TypeScript / package.json
- Test mode switches **only affect local UI**, not the backend model

---

## 🐛 Known Limitations

- Relies on ChatGPT's internal API structure — may break if OpenAI changes the response format
- History capped at 50 entries
- Message count uses a rolling 24-hour window

---

## 🧑‍💻 Development

```bash
# Load the extension
chrome://extensions/ → Developer mode → Load unpacked

# After code changes → Reload the extension → Refresh ChatGPT page
```

---

## 📄 License

MIT
