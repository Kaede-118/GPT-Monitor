// background.js
// ============================================
// CloudSync — 编排层（WebSocket 事件驱动）
// 副作用全部收口在此文件
// ============================================

importScripts(
    'cloudsync/config.js',
    'cloudsync/utils/chatgpt.js',
    'cloudsync/token.js',
    'cloudsync/sync-state.js'
);

// 日志桥接：输出到 console + 同步到 Debug 面板
var BGLOG_KEY = 'cloudsync:bglog';
function bLog() {
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, args);
    var text = args.join(' ');
    chrome.storage.local.get(BGLOG_KEY, function (data) {
        var arr = data[BGLOG_KEY] || [];
        arr.push(text);
        if (arr.length > 100) arr.splice(0, arr.length - 100);
        chrome.storage.local.set({ [BGLOG_KEY]: arr });
    });
}

bLog('[CloudSync] Background 已启动');

// ============================================
// 实例化
// ============================================
var tokenManager = new TokenManager();

var currentConversationId = null;
var lastWrittenStateValue = null;

// ============================================
// 从 storage 恢复运行时状态
// ============================================
async function restoreRuntimeState() {
    var data = await chrome.storage.local.get(['cloudsync:token', 'cloudsync:url']);
    if (data['cloudsync:token']) {
        tokenManager.setToken(data['cloudsync:token']);
        bLog('[CloudSync] Token 已从存储恢复');
    }
    if (data['cloudsync:url']) {
        var id = getCurrentConversationId(data['cloudsync:url']);
        if (id) {
            currentConversationId = id;
            lastWrittenStateValue = null;
            bLog('[CloudSync] 对话已恢复:', id);
            writeStateAndBadge({ state: SyncState.SYNCED });
        }
    }
}

// ============================================
// Badge 更新
// ============================================
function updateBadge(state) {
    if (state.value === 'OUTDATED') {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#e33' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// ============================================
// 状态写入 chrome.storage 供 Popup 消费
// ============================================
function writeState(stateObj) {
    var key = CloudSyncConfig.STORAGE_KEY;
    var data = {};
    data[key] = {
        state: stateObj,
        conversationId: currentConversationId,
        updatedAt: Date.now()
    };
    chrome.storage.local.set(data);
    bLog('[CloudSync] 写入状态 ->', stateObj.value);
}

function writeStateAndBadge(result) {
    updateBadge(result.state);
    writeState(result.state);
}

// ============================================
// 处理 WS 事件（来自 inject.js → content.js）
// ============================================
function handleWsEvent(data) {
    var payload = data.payload;
    if (!payload) return;

    if (payload.conversation_id !== currentConversationId) return;

    var msg = payload.update_content && payload.update_content.message;
    if (!msg) return;
    if (msg.author && msg.author.role !== 'assistant') return;
    if (msg.status !== 'finished_successfully') return;

    bLog('[CloudSync] WS 事件: 云端 assistant 消息完成 -> OUTDATED');
    if (lastWrittenStateValue !== 'OUTDATED') {
        lastWrittenStateValue = 'OUTDATED';
        writeStateAndBadge({ state: SyncState.OUTDATED });
    }
}

// ============================================
// 监听 storage 变化（content.js 写入的 token/url）
// ============================================
chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;

    if (changes['cloudsync:token']) {
        var token = changes['cloudsync:token'].newValue;
        if (tokenManager.setToken(token)) {
            bLog('[CloudSync] Token 已更新');
        }
    }

    if (changes['cloudsync:url']) {
        var url = changes['cloudsync:url'].newValue;
        var id = getCurrentConversationId(url);
        if (id && id !== currentConversationId) {
            currentConversationId = id;
            lastWrittenStateValue = null;
            bLog('[CloudSync] 切换对话:', id);
            writeStateAndBadge({ state: SyncState.SYNCED });
        }
    }
});

// ============================================
// 监听来自 content.js 的消息
// ============================================
chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === 'cloudsync-ws-event') {
        handleWsEvent(message.data);

    } else if (message.type === 'cloudsync-ws-turn-complete') {
        if (message.conversation_id === currentConversationId) {
            bLog('[CloudSync] WS turn-complete -> OUTDATED');
            if (lastWrittenStateValue !== 'OUTDATED') {
                lastWrittenStateValue = 'OUTDATED';
                writeStateAndBadge({ state: SyncState.OUTDATED });
            }
        }

    } else if (message.type === 'cloudsync-local-sync') {
        if (lastWrittenStateValue === 'OUTDATED') {
            bLog('[CloudSync] 本地回复，重置 SYNCED');
            lastWrittenStateValue = 'SYNCED';
            writeStateAndBadge({ state: SyncState.SYNCED });
        }

    } else if (message.type === 'cloudsync-page-init') {
        var id = getCurrentConversationId(message.url);
        if (id) {
            currentConversationId = id;
            lastWrittenStateValue = null;
            bLog('[CloudSync] 页面加载，初始化为 SYNCED');
            writeStateAndBadge({ state: SyncState.SYNCED });
        }
    }
});

// ============================================
// 启动
// ============================================
chrome.runtime.onInstalled.addListener(function () {
    bLog('[CloudSync] 已安装');
});

restoreRuntimeState();
