// popup.js
async function render() {
    const data = await chrome.storage.local.get(['detected', 'modelHistory', 'currentModel', 'messageTimestamps']);
    const detected = data.detected || false;
    const history = data.modelHistory || [];
    const currentModel = data.currentModel || '未检测';

    const badge = document.getElementById('currentModelBadge');
    const modelStr = String(currentModel);
    const isMini = modelStr.toLowerCase().includes('mini');
    badge.textContent = modelStr;
    badge.className = 'model-badge ' + (isMini ? 'mini' : 'normal');

    const dot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const countText = document.getElementById('countText');
    dot.className = 'status-dot ' + (isMini ? 'mini' : (currentModel === '未检测' ? 'unknown' : 'normal'));
    statusText.textContent = isMini ? '⚠️ 已降智' : (currentModel === '未检测' ? '未检测' : '✅ 正常');

    const switchCount = history.length > 0 ? history.length - 1 : 0;
    countText.textContent = history.length > 0 ? `切换 ${switchCount} 次` : '';

    // ⏱️ 消息计数
    const messageTimestamps = data.messageTimestamps || [];
    const now = Date.now();
    const ts3h = messageTimestamps.filter(t => now - t < 3 * 60 * 60 * 1000);
    const ts24h = messageTimestamps.filter(t => now - t < 24 * 60 * 60 * 1000);

    const msg3h = document.getElementById('msg3h');
    msg3h.textContent = ts3h.length;
    msg3h.className = 'msg-count' + (ts3h.length >= 160 ? ' danger' : ts3h.length >= 100 ? ' warn' : ' safe');

    document.getElementById('msg24h').textContent = ts24h.length;

    const list = document.getElementById('historyList');
    if (history.length === 0) {
        list.innerHTML = '<div class="empty">暂无模型切换记录</div>';
        return;
    }

    const validHistory = history.filter(item => item && item.model);
    if (validHistory.length === 0) {
        list.innerHTML = '<div class="empty">暂无模型切换记录</div>';
        return;
    }

    list.innerHTML = validHistory.map(item => {
        const modelName = String(item.model);
        const timeStr = String(item.time || '');
        const isMini = modelName.toLowerCase().includes('mini');
        return `
            <div class="history-item">
                <span class="model ${isMini ? 'mini' : 'normal'}">
                    ${isMini ? '🔴' : '🟢'} ${modelName}
                </span>
                <span class="time">${timeStr}</span>
            </div>
        `;
    }).join('');
}

async function clearHistory() {
    await chrome.storage.local.set({ modelHistory: [] });
    render();
}

// ℹ️ 使用限制弹窗
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const modalClose = document.getElementById('modalClose');
infoBtn.addEventListener('click', () => infoModal.classList.add('show'));
modalClose.addEventListener('click', () => infoModal.classList.remove('show'));
infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.classList.remove('show'); });

document.getElementById('clearMsgBtn').addEventListener('click', () => {
    if (confirm('确定要清零消息计数？')) {
        chrome.storage.local.set({ messageTimestamps: [] });
        render();
    }
});
document.getElementById('testBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['currentModel']);
    const cur = data.currentModel || '';
    const next = cur.toLowerCase().includes('mini') ? 'gpt-test' : 'gpt-test-mini';
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            world: 'MAIN',
            func: (name) => window.__modelMonitor?.setModel(name),
            args: [next]
        });
    }
});
document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

render();
chrome.storage.onChanged.addListener(() => render());