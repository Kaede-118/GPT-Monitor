// popup.js
function formatDuration(ms) {
    if (ms == null || ms < 0) return '-';
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return '<1分钟';
    const min = Math.floor(totalSec / 60);
    if (min < 60) return `${min}分钟`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}小时${m}分钟`;
}

async function render() {
    const data = await chrome.storage.local.get(['detected', 'modelHistory', 'currentModel', 'messageTimestamps']);
    const history = data.modelHistory || [];
    const currentModel = data.currentModel;
    const messageTimestamps = data.messageTimestamps || [];
    const now = Date.now();

    const isMini = currentModel ? String(currentModel).toLowerCase().includes('mini') : false;

    // 当前模型卡片
    const modelColor = isMini ? '#f38ba8' : '#a6e3a1';
    const modelEmoji = isMini ? '🔴' : '🟢';
    const badgeText = currentModel || '未检测';

    let startTimeStr = '';
    if (currentModel && history.length > 0 && history[0].model === currentModel && history[0].time) {
        startTimeStr = history[0].time;
    }

    let currentTurns = 0, currentDurMs = 0;
    if (currentModel && history.length > 0 && history[0].model === currentModel && history[0].timestamp) {
        currentTurns = history[0].turns || 0;
        currentDurMs = history[0].duration != null ? history[0].duration : Date.now() - history[0].timestamp;
    }
    const currentDurStr = formatDuration(currentDurMs);

    document.getElementById('currentModelCard').innerHTML = `
        <div style="font-size:14px;font-weight:600;color:${modelColor};">${modelEmoji} ${badgeText}</div>
        <div style="font-size:12px;color:#cdd6f4;margin-top:3px;">${currentTurns}轮 | ${currentDurStr}</div>
        <div style="font-size:11px;color:#585b70;margin-top:2px;">${startTimeStr}</div>
    `;

    // ⏱️ 消息计数
    const ts3h = messageTimestamps.filter(t => now - t < 3 * 60 * 60 * 1000);
    const ts24h = messageTimestamps.filter(t => now - t < 24 * 60 * 60 * 1000);

    const msg3h = document.getElementById('msg3h');
    msg3h.textContent = ts3h.length;
    msg3h.className = 'msg-count' + (ts3h.length >= 160 ? ' danger' : ts3h.length >= 100 ? ' warn' : ' safe');
    document.getElementById('msg24h').textContent = ts24h.length;

    // 历史记录（跳过当前模型）
    const list = document.getElementById('historyList');
    if (!history || history.length === 0 || (history.length === 1 && history[0].model === currentModel)) {
        list.innerHTML = '<div style="padding:8px 0;color:#6c7086;text-align:center;font-size:12px;">暂无切换记录</div>';
        return;
    }

    const validHistory = history.filter(item => item && item.model);
    list.innerHTML = validHistory.map((item, index) => {
        const isCurrent = item.model === currentModel && index === 0;
        if (isCurrent) return '';
        const modelName = String(item.model);
        const timeStr = String(item.time || '');
        const isMiniItem = modelName.toLowerCase().includes('mini');
        const turnsStr = item.turns != null ? item.turns : '-';
        const durStr = formatDuration(item.duration);
        const c = isMiniItem ? '#f38ba8' : '#a6e3a1';
        const emoji = isMiniItem ? '🔴' : '🟢';
        return `
            <div style="padding:6px 0;border-bottom:1px solid #313244;">
                <div style="font-size:13px;font-weight:500;color:${c};">${emoji} ${modelName}</div>
                <div style="font-size:12px;color:#cdd6f4;margin-top:2px;">${turnsStr}轮 | ${durStr}</div>
                <div style="font-size:11px;color:#6c7086;margin-top:1px;">${timeStr}</div>
            </div>
        `;
    }).filter(Boolean).join('');
}

async function clearHistory() {
    if (!confirm('确认清除监控数据？\n\n将删除：\n• 当前模型状态\n• 模型切换历史\n• 近3h消息统计\n• 近24h消息统计\n\n该操作不可撤销。')) return;
    await chrome.storage.local.set({
        messageTimestamps: [],
        modelHistory: [],
        currentModel: null,
        detected: false
    });
    render();
}

// ℹ️ 使用限制弹窗
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const modalClose = document.getElementById('modalClose');
infoBtn.addEventListener('click', () => infoModal.classList.add('show'));
modalClose.addEventListener('click', () => infoModal.classList.remove('show'));
infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.classList.remove('show'); });

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