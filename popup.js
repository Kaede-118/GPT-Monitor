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

function formatRemaining(ms) {
    if (ms <= 0) return '0m';
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatClock(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getActivityEmoji(count) {
    if (count <= 29) return '🟢';
    if (count <= 53) return '🟡';
    if (count <= 79) return '🟠';
    return '🔴';
}

async function render() {
    const data = await chrome.storage.local.get(['detected', 'modelHistory', 'currentModel', 'messageTimestamps']);
    const history = data.modelHistory || [];
    const currentModel = data.currentModel;
    const messageTimestamps = data.messageTimestamps || [];
    const now = Date.now();

    const isMini = currentModel ? String(currentModel).toLowerCase().includes('mini') : false;
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
        currentDurMs = now - history[0].timestamp;
    }
    const currentDurStr = formatDuration(currentDurMs);

    const lastActiveTs = (currentModel && history.length > 0 && history[0].model === currentModel && history[0].lastActive) ? history[0].lastActive : (messageTimestamps.length > 0 ? messageTimestamps[messageTimestamps.length - 1] : null);
    let activeTimeStr = '暂无';
    if (lastActiveTs) {
        const diff = now - lastActiveTs;
        if (diff < 60000) {
            activeTimeStr = '刚刚';
        } else if (diff < 3600000) {
            activeTimeStr = `${Math.floor(diff / 60000)}分钟前`;
        } else {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            activeTimeStr = `${h}小时${m}分钟前`;
        }
    }

    const ts1h = messageTimestamps.filter(t => now - t < 60 * 60 * 1000);
    const ts3h = messageTimestamps.filter(t => now - t < 3 * 60 * 60 * 1000);
    const ts24h = messageTimestamps.filter(t => now - t < 24 * 60 * 60 * 1000);

    const count1h = ts1h.length;
    const count3h = ts3h.length;
    const count3hColor = count3h >= 160 ? '#f38ba8' : count3h >= 100 ? '#f9e2af' : '#a6e3a1';
    const count24h = ts24h.length;
    const statusEmoji = getActivityEmoji(count1h);

    document.getElementById('currentModelCard').innerHTML = `
        <div style="font-size:14px;font-weight:600;color:${modelColor};">${modelEmoji} ${badgeText}</div>
        <div style="font-size:12px;color:#cdd6f4;margin-top:3px;">${currentTurns}轮 | ${currentDurStr}</div>
        <div style="font-size:12px;color:#6c7086;margin-top:2px;">🕒 活跃 ${activeTimeStr}</div>
        <div style="font-size:11px;color:#585b70;margin-top:2px;">📌 ${startTimeStr || ''}</div>
    `;

    document.getElementById('rightStats').innerHTML = `
        <div style="font-size:13px;white-space:nowrap;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span>🔥 近1h</span>
                    <span style="font-weight:600;">${count1h}</span>
                    <span>${statusEmoji}</span>
                    <span title="(160/3=53.33轮/小时)
🟢0~29
🟡30~53
🟠54~79
🔴80+" style="cursor:help;color:#585b70;font-size:11px;">ⓘ</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                    <span>⏳ 近3h</span>
                    <span>
                        <span style="font-weight:600;color:${count3hColor};">${count3h}</span>
                        <span style="color:#6c7086;font-size:11px;"> / 160</span>
                    </span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                    <span>📅 近24h</span>
                    <span style="font-weight:600;">${count24h}</span>
                </div>
            </div>
        `;

    // 恢复预测
    const recoveryEl = document.getElementById('recoveryPrediction');
    if (ts3h.length === 0) {
        recoveryEl.innerHTML = `
            <div style="color:#585b70;font-size:12px;padding:6px 0;border-bottom:1px solid #313244;">
                <div style="font-weight:500;color:#6c7086;margin-bottom:4px;">⌛ 恢复预测</div>
                <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#cdd6f4;">+1</span><span style="color:#585b70;">—</span></div>
                <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#cdd6f4;">+10</span><span style="color:#585b70;">—</span></div>
                <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#cdd6f4;">✓</span><span style="color:#585b70;">—</span></div>
            </div>
        `;
    } else {
        const sorted = [...ts3h].sort((a, b) => a - b);
        const t1 = sorted[0] + 3 * 60 * 60 * 1000;
        const r1 = Math.max(0, t1 - now);
        const r1Str = formatRemaining(r1);
        const t1Clock = formatClock(t1);

        let r10Str = '—', t10Clock = '';
        if (sorted.length >= 10) {
            const t10 = sorted[9] + 3 * 60 * 60 * 1000;
            const r10 = Math.max(0, t10 - now);
            r10Str = formatRemaining(r10);
            t10Clock = formatClock(t10);
        }

        const tAll = sorted[sorted.length - 1] + 3 * 60 * 60 * 1000;
        const rAll = Math.max(0, tAll - now);
        const rAllStr = formatRemaining(rAll);
        const tAllClock = formatClock(tAll);

        recoveryEl.innerHTML = `
            <div style="color:#585b70;font-size:12px;padding:6px 0;border-bottom:1px solid #313244;">
                <div style="font-weight:500;color:#6c7086;margin-bottom:4px;">⌛ 恢复预测</div>
                <div style="display:flex;padding:2px 0;"><span style="color:#cdd6f4;width:30px;">+1</span><span style="color:#cdd6f4;flex:1;text-align:right;">${r1Str}</span><span style="color:#585b70;text-align:right;width:70px;">(${t1Clock})</span></div>
                <div style="display:flex;padding:2px 0;"><span style="color:#cdd6f4;width:30px;">+10</span><span style="color:#cdd6f4;flex:1;text-align:right;">${r10Str}</span><span style="color:#585b70;text-align:right;width:70px;">${r10Str !== '—' ? `(${t10Clock})` : ''}</span></div>
                <div style="display:flex;padding:2px 0;"><span style="color:#cdd6f4;width:30px;">✓</span><span style="color:#cdd6f4;flex:1;text-align:right;">${rAllStr}</span><span style="color:#585b70;text-align:right;width:70px;">(${tAllClock})</span></div>
            </div>
        `;
    }

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
                <div style="font-size:11px;color:#6c7086;margin-top:1px;">📌 ${timeStr}</div>
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

// ℹ️ 使用限制（内联替换，与 dropdown 一致）
var savedMainHtml = '';
function showUsageInfo() {
    const panel = document.getElementById('mainPanel');
    savedMainHtml = panel.innerHTML;
    panel.innerHTML = `
        <div style="font-size:13px;line-height:1.6;">
            <div style="color:#89b4fa;font-size:15px;font-weight:600;margin:0 0 12px;">ℹ️ GPT-5.5 使用限制</div>
            <div class="info-section">
                <div class="info-label">🆓 免费版</div>
                <div class="info-detail"><span class="highlight">约10轮/5小时</span>，超标自动降 <span class="info-warn">mini</span></div>
            </div>
            <div class="info-section">
                <div class="info-label">⭐ Plus/Go</div>
                <div class="info-detail"><span class="highlight">160轮/3小时</span>，超标自动降 <span class="info-warn">mini</span></div>
                <div class="info-detail" style="color:#585b70;font-size:11px;margin-top:1px;">≈53轮/小时 ≈0.88轮/分钟</div>
            </div>
            <div class="info-section">
                <div class="info-label">🧠 Thinking 模式</div>
                <div class="info-detail">Plus 手动选;<span class="highlight">Go 10轮/5小时</span></div>
            </div>
            <div class="info-section">
                <div class="info-label">💡 推测</div>
                <div class="info-detail">额度是逐条恢复，不是到点重置</div>
            </div>
            <div class="info-section">
                <div class="info-warn">⚠️ 作者实测</div>
                <div class="info-detail">不稳定的网络环境（VPN/节点）和要求 GPT 进行大量编码会大量消耗额度，导致降智</div>
            </div>
            <div style="text-align:center;padding-top:10px;border-top:1px solid #313244;margin-top:10px;">
                <button id="usageBackBtn" style="width:100%;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#313244;color:#cdd6f4;">← 返回</button>
            </div>
        </div>
    `;
    document.getElementById('usageBackBtn').addEventListener('click', showMainPanel);
}
function showMainPanel() {
    document.getElementById('mainPanel').innerHTML = savedMainHtml;
    savedMainHtml = '';
    // 重新绑定事件
    document.getElementById('testBtn').addEventListener('click', testBtnHandler);
    document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
    render();
}

document.getElementById('infoBtn').addEventListener('click', showUsageInfo);

const testBtnHandler = async () => {
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
};
document.getElementById('testBtn').addEventListener('click', testBtnHandler);
document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

render();
chrome.storage.onChanged.addListener(() => render());
setInterval(render, 60000);