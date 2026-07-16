// content.js (ISOLATED world)
// ============================================
// 桥接 MAIN world → Background / chrome.storage.local
// CloudSync Badge — 页面级状态浮标（Singleton）
// WS 事件转发（inject.js → background.js）
// ============================================

// 时间戳日志（UTC+8）
(function () {
    function ts() {
        var d = new Date();
        var ms = d.getTime() + 8 * 3600000;
        return new Date(ms).toISOString().slice(11, 23);
    }
    var origLog = console.log;
    var origWarn = console.warn;
    console.log = function () {
        origLog.apply(console, ['[' + ts() + ']'].concat(Array.prototype.slice.call(arguments)));
    };
    console.warn = function () {
        origWarn.apply(console, ['[' + ts() + ']'].concat(Array.prototype.slice.call(arguments)));
    };
})();

console.log('[CloudSync] content.js 已加载');

var STORAGE_KEY = 'cloudsync';
var lastState = null;
var movePending = false;
var domObserver = null;
var refreshTimer = null;
var cachedMoreBtn = null;
var cachedBadge = null;

// ============================================
// 写入 storage（token / url）
// ============================================
function writeToStorage(type, value) {
    var key = 'cloudsync:' + type;
    var data = {};
    data[key] = value;
    chrome.storage.local.set(data);
}

// ============================================
// 监听 postMessage（来自 inject.js）
// ============================================
window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || !data.type) return;

    if (data.type === 'cloudsync-token' && data.token) {
        writeToStorage('token', data.token);

    } else if (data.type === 'cloudsync-url-change' && data.url) {
        writeToStorage('url', data.url);

    } else if (data.type === 'cloudsync-ws-event') {
        chrome.runtime.sendMessage({ type: 'cloudsync-ws-event', data: data.data });

    } else if (data.type === 'cloudsync-ws-turn-complete') {
        chrome.runtime.sendMessage({ type: 'cloudsync-ws-turn-complete', conversation_id: data.conversation_id });

    } else if (data.type === 'cloudsync-sse-complete') {
        if (lastState) moveCloudSyncBadge(lastState, 0, true);

    } else if (data.type === 'cloudsync-local-sync') {
        chrome.runtime.sendMessage({ type: 'cloudsync-local-sync' });

    } else if (data.type === 'cloudsync-debug') {
        debugPanelAdd(data.text);
        persistInjLog(data.text);
    }
});

writeToStorage('url', location.href);
chrome.runtime.sendMessage({ type: 'cloudsync-page-init', url: location.href });

// ============================================
// Debug 面板
// ============================================
var DEBUG_MAX = 80;
var debugLogs = [];
var debugCollapsed = true;
var debugPanel = null;
var debugBody = null;
var debugPending = false;

function createDebugPanel() {
    if (document.getElementById('cloudsync-debug-panel')) return;

    var panel = document.createElement('div');
    panel.id = 'cloudsync-debug-panel';
    panel.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999;font-family:monospace;font-size:11px;line-height:1.5;color:#cdd6f4;background:#1e1e2ee0;border:1px solid #45475a;border-radius:8px;backdrop-filter:blur(6px);overflow:hidden;cursor:pointer;max-width:480px;';

    var header = document.createElement('div');
    header.id = 'cloudsync-debug-header';
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#313244;font-weight:600;user-select:none;';
    header.innerHTML = '<span>☁ Debug</span><span id="cloudsync-debug-toggle" style="font-size:14px;">▸</span>';

    debugBody = document.createElement('div');
    debugBody.id = 'cloudsync-debug-body';
    debugBody.style.cssText = 'display:none;max-height:240px;overflow-y:auto;padding:4px 0;';

    panel.appendChild(header);
    panel.appendChild(debugBody);
    document.body.appendChild(panel);
    debugPanel = panel;

    header.addEventListener('click', function () {
        debugCollapsed = !debugCollapsed;
        document.getElementById('cloudsync-debug-toggle').textContent = debugCollapsed ? '▸' : '▾';
        debugBody.style.display = debugCollapsed ? 'none' : 'block';
        if (!debugCollapsed) renderDebugLogs();
    });
}

function debugPanelAdd(text) {
    debugLogs.push(text);
    if (debugLogs.length > DEBUG_MAX) debugLogs.shift();
    if (debugPending) return;
    debugPending = true;
    requestAnimationFrame(function () {
        debugPending = false;
        if (!debugCollapsed && debugBody) renderDebugLogs();
    });
}

function renderDebugLogs() {
    debugBody.innerHTML = '';
    for (var i = 0; i < debugLogs.length; i++) {
        var el = document.createElement('div');
        el.style.cssText = 'padding:2px 10px;border-bottom:1px solid #31324444;word-break:break-all;';
        el.textContent = debugLogs[i];
        debugBody.appendChild(el);
    }
    debugBody.scrollTop = debugBody.scrollHeight;
}

// 持久化 inject 日志到 storage，刷新后可回溯
function persistInjLog(text) {
    chrome.storage.local.get('cloudsync:injlog', function (data) {
        var arr = data['cloudsync:injlog'] || [];
        arr.push(text);
        if (arr.length > 100) arr.splice(0, arr.length - 100);
        chrome.storage.local.set({ 'cloudsync:injlog': arr });
    });
}

// 等 DOM 就绪后再创建 Debug 面板
function initDebugPanel() {
    if (document.body) {
        createDebugPanel();
    } else {
        setTimeout(initDebugPanel, 200);
    }
}
initDebugPanel();

// ============================================
// DOM 定位工具
// ============================================
function getLatestMoreButton(forceRefresh) {
    if (!forceRefresh && cachedMoreBtn && cachedMoreBtn.isConnected) {
        return cachedMoreBtn;
    }
    var buttons = document.querySelectorAll('button[aria-label="更多操作"]');
    cachedMoreBtn = buttons.length > 0 ? buttons[buttons.length - 1] : null;
    return cachedMoreBtn;
}

function updateBadgeAppearance(badge, stateValue) {
    console.log('[CloudSync] updateBadgeAppearance old=' + badge.dataset.state + ' new=' + stateValue);
    if (badge.dataset.state === stateValue) {
        console.log('[CloudSync] updateBadgeAppearance skipped (same state)');
        return;
    }
    badge.dataset.state = stateValue;

    if (stateValue === 'OUTDATED') {
        badge.textContent = 'OUTDATED';
        badge.style.background = '#f38ba8';
        badge.style.color = '#ffffff';
        badge.style.display = 'inline-flex';
        console.log('[CloudSync] Badge DOM updated -> OUTDATED');
    } else if (stateValue === 'SYNCED') {
        badge.textContent = 'SYNCED';
        badge.style.background = '#89b4fa';
        badge.style.color = '#ffffff';
        badge.style.display = 'inline-flex';
        console.log('[CloudSync] Badge DOM updated -> SYNCED');
    } else if (stateValue === 'ERROR') {
        badge.textContent = 'ERROR';
        badge.style.background = '#f9e2af';
        badge.style.color = '#1e1e2e';
        badge.style.display = 'inline-flex';
        console.log('[CloudSync] Badge DOM updated -> ERROR');
    } else {
        badge.style.display = 'none';
    }
}

function moveCloudSyncBadge(data, retryCount, forceRefresh) {
    if (retryCount == null) retryCount = 0;
    if (!data || !data.state) return;
    lastState = data;

    var moreBtn = getLatestMoreButton(forceRefresh);
    if (!moreBtn || !moreBtn.parentElement) {
        if (retryCount >= 15) {
            console.log('[CloudSync] moveCloudSyncBadge retry=#' + retryCount + ' 超时，停止重试');
            return;
        }
        console.log('[CloudSync] moveCloudSyncBadge retry=#' + retryCount + ' 未找到 more button，2s 后重试');
        setTimeout(function () {
            if (!lastState) return;
            if (getLatestMoreButton(forceRefresh)) return;
            moveCloudSyncBadge(lastState, retryCount + 1, forceRefresh);
        }, 2000);
        return;
    }

    console.log('[CloudSync] moveCloudSyncBadge retry=#' + retryCount + ' state=' + data.state.value + ' conversationId=' + data.conversationId);

    var badge = cachedBadge;

    if (!badge || !badge.isConnected) {
        badge = moreBtn.parentElement.querySelector('#cloudsync-status-badge');

        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'cloudsync-status-badge';
            badge.style.cssText = [
                'display: inline-flex',
                'align-items: center',
                'padding: 4px 12px',
                'margin-left: 8px',
                'border-radius: 6px',
                'font-size: 13px',
                'font-weight: 600',
                'font-family: system-ui, sans-serif',
                'transition: all 0.3s ease',
                'user-select: none'
            ].join(';') + ';';
        }

        cachedBadge = badge;
    }

    if (
        badge.parentElement !== moreBtn.parentElement ||
        badge.previousSibling !== moreBtn
    ) {
        moreBtn.parentElement.insertBefore(badge, moreBtn.nextSibling);
    }
    updateBadgeAppearance(badge, data.state.value);
}

// ============================================
// MutationObserver（仅检测缓存失效时重新定位）
// ============================================
function startObserver() {
    if (domObserver) domObserver.disconnect();

    var target = document.querySelector('[role="presentation"]') || document.body;

    domObserver = new MutationObserver(function () {
        if (movePending) return;
        movePending = true;
        requestAnimationFrame(function () {
            movePending = false;

            if (!lastState) return;

            if (
                cachedMoreBtn &&
                cachedMoreBtn.isConnected &&
                cachedBadge &&
                cachedBadge.isConnected &&
                cachedBadge.parentElement === cachedMoreBtn.parentElement
            ) {
                return;
            }

            moveCloudSyncBadge(lastState);
        });
    });

    domObserver.observe(target, { childList: true, subtree: true });
}

// ============================================
// 状态监听 & 初始化
// ============================================
chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;

    if (changes[STORAGE_KEY]) {
        var oldVal = changes[STORAGE_KEY].oldValue;
        var newVal = changes[STORAGE_KEY].newValue;
        var oldState = oldVal && oldVal.state ? oldVal.state.value : null;
        var newState = newVal && newVal.state ? newVal.state.value : null;
        console.log('[CloudSync] Badge storage.onChanged key=' + STORAGE_KEY + ' old=' + (oldState || 'null') + ' new=' + (newState || 'null'));
        moveCloudSyncBadge(newVal);

        // 自动刷新：进入 OUTDATED 3 秒后重载页面
        if (newState === 'OUTDATED' && oldState !== 'OUTDATED') {
            chrome.storage.local.get('cloudsync:autoRefresh', function (data) {
                if (data['cloudsync:autoRefresh'] !== false) {
                    console.log('[CloudSync] 3秒后自动刷新页面');
                    refreshTimer = setTimeout(function () {
                        console.log('[CloudSync] 自动刷新');
                        location.reload();
                    }, 3000);
                }
            });
        } else if (newState !== 'OUTDATED' && refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
    }
});

// ============================================
// 监听 background 日志 → Debug 面板
// ============================================
chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes['cloudsync:bglog']) {
        var oldArr = changes['cloudsync:bglog'].oldValue || [];
        var newArr = changes['cloudsync:bglog'].newValue || [];
        for (var i = oldArr.length; i < newArr.length; i++) {
            debugPanelAdd(newArr[i]);
        }
    }
});

chrome.storage.local.get(['cloudsync:bglog', 'cloudsync:injlog'], function (data) {
    var bg = data['cloudsync:bglog'] || [];
    var inj = data['cloudsync:injlog'] || [];
    var all = bg.concat(inj);
    all.sort();
    for (var i = 0; i < all.length; i++) {
        debugPanelAdd(all[i]);
    }
});

chrome.storage.local.get(STORAGE_KEY, function (data) {
    if (data[STORAGE_KEY]) {
        moveCloudSyncBadge(data[STORAGE_KEY]);
    }
    startObserver();
});

