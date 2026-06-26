// content.js
console.log('🔍 Content script 已加载');

// ============================================
// 监听页面主世界的 postMessage，直接写 storage
// ============================================
window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.target === 'storage') {
        const { type, data, id } = event.data;
        console.log('📨 写入 storage:', type, data);

        if (type === 'SET_STORAGE') {
            chrome.storage.local.set(data, () => {
                chrome.storage.local.get('messageTimestamps', (result) => {
                    window.postMessage({
                        id: id,
                        response: { done: true, timestamps: result.messageTimestamps || [] },
                        target: 'page'
                    }, '*');
                });
            });
        }
    }
});

// ============================================
// 监听来自 background 的 PING
// ============================================
// ============================================
// 监听 storage 变化，实时推送消息计数到 MAIN world
// ============================================
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.messageTimestamps) {
        window.postMessage({
            type: 'TIMESTAMPS_UPDATED',
            timestamps: changes.messageTimestamps.newValue || [],
            target: 'storage'
        }, '*');
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
        sendResponse({ pong: true });
        return true;
    }
});

console.log('💡 Content script 已就绪');