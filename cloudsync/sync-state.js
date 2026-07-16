// sync-state.js
// ============================================
// SyncState — 共享状态常量
// 无 chrome.* 依赖，纯数据
// ============================================

const SyncState = {
    UNKNOWN: { value: 'UNKNOWN', reason: 'initializing' },
    SYNCED: { value: 'SYNCED', reason: 'up_to_date' },
    OUTDATED: { value: 'OUTDATED', reason: 'ws_update' },
    ERROR: { value: 'ERROR', reason: 'ws_error' },
    NO_TOKEN: { value: 'NO_TOKEN', reason: 'no_token' }
};
