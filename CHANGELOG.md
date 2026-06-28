# Changelog

## [1.4] - 2025-06-29

### Added
- `formatDuration()` helper (injected script + popup)
- History entries: `turns` (message count) and `duration` (ms) fields
- Current model card: name, turns+duration, start time
- Real-time dropdown refresh on new messages (if open)
- Usage info: "推测：额度是逐条恢复，不是到点重置"
- `.gitignore` entry for `ignore/`

### Changed
- **Card layout** for both popup & dropdown:
  - Header: `📊 模型监控` + `ⓘ` only
  - Model card: emoji + name, `X轮 | XhXm`, start time
  - Message stats (近3h/近24h) aligned right of the card
  - History separate section titled "模型切换历史"
  - History entries: 3-line format (name, turns|dur, timestamp)
  - Current model excluded from history list
- **Clear unified**: single `🗑️ 清除监控数据` — clears timestamps, history, model, detected
- **Model turn accounting**: new model `turns=1`, old model `filter(t≥start).length`, no cross-deduction
- **Duration format**: `<1分钟` instead of `刚刚`
- **Usage limit text** normalized: `约10条/5小时`, `160条/3小时`, `Plus 手动选;Go 10条/5小时`

### Removed
- Standalone "清零消息计数" button (popup + dropdown)
- Status row (dot + 已降智/正常 + 切换次数)
- "切换 X 次" text
- "(参考)" label from 近24h
- Unused CSS classes
