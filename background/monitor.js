// background.js
console.log('🔍 Background service worker 已启动');

let currentModel = null;
let currentTabId = null;
let detected = false;
let injectedTabs = new Set();

// ============================================
// 消息计数（每 POST 一条 conversation 计 1 次）
// ============================================
function recordMessage() {
    chrome.storage.local.get(['messageTimestamps', 'modelHistory', 'currentModel'], (data) => {
        let ts = data.messageTimestamps || [];
        const now = Date.now();
        ts = ts.filter(t => now - t < 24 * 60 * 60 * 1000);
        ts.push(now);
        chrome.storage.local.set({ messageTimestamps: ts }, () => {
            chrome.runtime.sendMessage({ type: 'MESSAGE_COUNT_UPDATED', timestamps: ts });
        });
    });
}

// ============================================
// 历史记录管理（background 备用）
// ============================================
async function addHistory(modelName) {
    console.log('📝 addHistory 被调用:', modelName);
    const data = await chrome.storage.local.get(['modelHistory']);
    let history = data.modelHistory || [];

    if (history.length > 0 && history[0].model === modelName) {
        console.log('⏭️ 模型与最新记录相同，跳过添加:', modelName);
        return;
    }

    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    history.unshift({
        model: modelName,
        time: timeStr,
        timestamp: now.getTime()
    });

    if (history.length > 50) {
        history = history.slice(0, 50);
        console.log('✂️ 历史记录超过50条，已裁剪');
    }

    await chrome.storage.local.set({ modelHistory: history });
    await chrome.storage.local.set({ currentModel: modelName });
    console.log('✅ 历史已保存, 当前模型:', modelName, '总记录数:', history.length);
}

// ============================================
// 执行注入（带 storage 数据）
// ============================================
function doInject(tabId) {
    if (injectedTabs.has(tabId)) {
        console.log('⏭️ 已注入过，跳过');
        return;
    }
    console.log('🔄 执行注入, tabId:', tabId);
    injectedTabs.add(tabId);

    // ✅ 读取 storage，直接传给页面主世界
    chrome.storage.local.get(['currentModel', 'modelHistory', 'detected', 'messageTimestamps']).then((storageData) => {
        console.log('📦 注入时携带 storage:', storageData);

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: function(storageData) {
                const _iid = Math.random().toString(36).slice(2, 6);
                const _ts = () => { const d=new Date(); return `${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };
                console.log(`[${_ts()}] 💉 [${_iid}] 注入 SSE 拦截器, storage:`, storageData);

                // ====================================
                // 页面主世界状态（从 storage 初始化）
                // ====================================
                let currentModel = storageData.currentModel || null;
                let modelHistory = storageData.modelHistory || [];
                let detected = storageData.detected || false;
                let messageTimestamps = storageData.messageTimestamps || [];
                let testToggle = false; // false → 下次测试切 mini
                let cloudsyncState = null;
                let cloudsyncAutoRefresh = true;
                let bannerEl = null;
                let logoBadgeEl = null;
                let dropdownEl = null;

                console.log(`📊 [${_ts()}] [${_iid}] 初始化状态:`, { currentModel, historyCount: modelHistory.length, detected });

                // 监听后台推送的消息计数更新
                window.addEventListener('message', function(event) {
                    if (event.source !== window) return;
                    if (!event.data) return;
                    var d = event.data;
                    if (d.type === 'TIMESTAMPS_UPDATED' && d.target === 'storage') {
                        messageTimestamps = d.timestamps;
                        renderCountBadge();
                        // 如果下拉菜单打开，刷新里面的数据
                        const dropdown = document.getElementById('gpt-history-dropdown');
                        if (dropdown && dropdown.style.display === 'block') {
                            const container = document.getElementById('gpt-badge-container');
                            if (container) updateDropdown(container);
                        }
                        console.log('📊 消息计数已更新:', messageTimestamps.length);
                    } else if (d.type === 'CLOUDSYNC_STATE_UPDATED' && d.target === 'page') {
                        cloudsyncState = d.state;
                        refreshCloudsyncDropdown();
                    } else if (d.type === 'CLOUDSYNC_AUTOREFRESH_UPDATED' && d.target === 'page') {
                        cloudsyncAutoRefresh = d.autoRefresh;
                        refreshCloudsyncDropdown();
                    }
                });

                // ====================================
                // 写入 storage（直接到 content.js）
                // ====================================
                function sendToStorage(data) {
                    return new Promise((resolve) => {
                        const id = Date.now() + Math.random();
                        const handler = (event) => {
                            if (event.source !== window) return;
                            if (event.data && event.data.id === id) {
                                window.removeEventListener('message', handler);
                                resolve(event.data.response);
                            }
                        };
                        window.addEventListener('message', handler);
                        window.postMessage({
                            type: 'SET_STORAGE',
                            data: data,
                            id: id,
                            target: 'storage'
                        }, '*');
                    });
                }

                // ====================================
                // 保存到 storage（只用于持久化）
                // ====================================
                async function saveToStorage(data) {
                    try {
                        const result = await sendToStorage(data);
                        if (result && result.timestamps) {
                            messageTimestamps = result.timestamps;
                        }
                        console.log('💾 storage 已保存:', Object.keys(data));
                    } catch (e) {
                        console.warn('⚠️ storage 保存失败:', e);
                    }
                }

                // ====================================
                // CloudSync 状态管理
                // ====================================
                function readFromStorage(keys) {
                    return new Promise(function (resolve) {
                        var id = Date.now() + Math.random();
                        var handler = function (event) {
                            if (event.source !== window) return;
                            if (event.data && event.data.id === id) {
                                window.removeEventListener('message', handler);
                                resolve(event.data.response);
                            }
                        };
                        window.addEventListener('message', handler);
                        window.postMessage({
                            type: 'GET_STORAGE',
                            data: { keys: keys },
                            id: id,
                            target: 'storage'
                        }, '*');
                    });
                }
                async function fetchCloudSyncState() {
                    try {
                        var result = await Promise.race([
                            readFromStorage(['cloudsync', 'cloudsync:autoRefresh']),
                            new Promise(function (_, reject) { setTimeout(reject, 3000); })
                        ]);
                        if (result && result['cloudsync']) cloudsyncState = result['cloudsync'];
                        if (result && result['cloudsync:autoRefresh'] !== undefined) {
                            cloudsyncAutoRefresh = result['cloudsync:autoRefresh'] !== false;
                        }
                    } catch (e) {
                        console.warn('⚠️ CloudSync 状态获取失败:', e);
                    }
                }
                function refreshCloudsyncDropdown() {
                    const dropdown = document.getElementById('gpt-history-dropdown');
                    if (dropdown && dropdown.style.display === 'block') {
                        const container = document.getElementById('gpt-badge-container');
                        if (container) updateDropdown(container);
                    }
                }

                // ====================================
                // 格式化持续时间
                // ====================================
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

                // ====================================
                // 显示横幅
                // ====================================
                function showBanner(modelName, isMini) {
                    const existing = document.getElementById('gpt-model-banner');
                    if (existing) {
                        if (existing.dataset.model === modelName) {
                            console.log(`⏭️ [${_ts()}] [${_iid}] 同模型横幅已存在，跳过`);
                            return;
                        }
                        console.log(`🔄 [${_ts()}] [${_iid}] 横幅模型不同，替换`);
                        existing.remove();
                    } else {
                        // 无已有横幅，短时间防抖防止自动消失后多副本并发
                        window._gpt_lastBannerTime = window._gpt_lastBannerTime || 0;
                        const diff = Date.now() - window._gpt_lastBannerTime;
                        if (diff < 3000) {
                            console.log(`⏭️ [${_ts()}] [${_iid}] 3秒防抖 (diff=${diff}ms)`);
                            return;
                        }
                    }
                    window._gpt_lastBannerTime = Date.now();
                    console.log(`🐛 [${_ts()}] [${_iid}] 弹横幅: ${modelName}`);

                    const banner = document.createElement('div');
                    banner.id = 'gpt-model-banner';
                    banner.dataset.model = modelName;

                    if (isMini) {
                        console.log(`🛑 [${_ts()}] [${_iid}] [横幅] 弹降智横幅 + 通知:`, modelName);
                        banner.style.cssText = `
                            position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
                            opacity: 0.9;
                            background: #dc2626; color: white; padding: 10px 20px;
                            text-align: center; font-weight: 500; font-size: 14px;
                            font-family: system-ui; box-shadow: 0 2px 12px rgba(220,38,38,0.3);
                            animation: slideDown 0.3s ease;
                        `;
                        banner.textContent = `⚠️ 模型已切换至 ${modelName} — 谨慎参考代码`;
                        document.body.prepend(banner);
                        console.log('🔴 [横幅] 降智横幅已插入 DOM');

                        try {
                            console.log('🔔 [通知] 准备弹降智通知:', modelName);
                            new Notification('⚠️ 模型已降智', {
                                body: `${modelName} — 谨慎参考代码`
                            });
                            console.log('🔔 [通知] 降智通知已弹出');
                        } catch (e) {
                            console.warn('⚠️ [通知] 降智通知失败:', e);
                        }

                        setTimeout(() => {
                            console.log('🔴 [横幅] 降智横幅开始淡出:', modelName);
                            banner.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                            banner.style.transform = 'translateY(-100%)';
                            banner.style.opacity = '0';
                            setTimeout(() => {
                                banner.remove();
                                console.log('🔴 [横幅] 降智横幅已移除');
                            }, 300);
                        }, 5000);
                    } else {
                        console.log('🟢 [横幅] 弹恢复横幅 + 通知:', modelName);
                        banner.style.cssText = `
                            position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
                            opacity: 0.9;
                            background: #22c55e; color: white; padding: 10px 20px;
                            text-align: center; font-weight: 500; font-size: 14px;
                            font-family: system-ui; box-shadow: 0 2px 12px rgba(34,197,94,0.3);
                            animation: slideDown 0.3s ease;
                        `;
                        banner.textContent = `⭐ 模型已切换至 ${modelName} — 可以放心使用`;
                        document.body.prepend(banner);
                        console.log('🟢 [横幅] 恢复横幅已插入 DOM');

                        try {
                            console.log('🔔 [通知] 准备弹恢复通知:', modelName);
                            new Notification('🟢 模型已恢复', {
                                body: `当前模型: ${modelName}`
                            });
                            console.log('🔔 [通知] 恢复通知已弹出');
                        } catch (e) {
                            console.warn('⚠️ [通知] 恢复通知失败:', e);
                        }

                        setTimeout(() => {
                            console.log('🟢 [横幅] 恢复横幅开始淡出:', modelName);
                            banner.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                            banner.style.transform = 'translateY(-100%)';
                            banner.style.opacity = '0';
                            setTimeout(() => {
                                banner.remove();
                                console.log('🟢 [横幅] 恢复横幅已移除');
                            }, 300);
                        }, 3000);
                    }

                    if (!document.getElementById('gpt-banner-style')) {
                        const style = document.createElement('style');
                        style.id = 'gpt-banner-style';
                        style.textContent = `
                            @keyframes slideDown {
                                from { transform: translateY(-100%); opacity: 0; }
                                to { transform: translateY(0); opacity: 1; }
                            }
                        `;
                        document.head.appendChild(style);
                    }
                }

// ====================================
// 渲染 Logo 旁边的模型徽章（放在 Logo 按钮右边）
// ====================================
function renderLogoBadge(modelName, isMini, retryCount) {
    const hasModel = !!currentModel;
    const badgeBg = !hasModel ? 'rgba(108,112,134,0.15)' : (isMini ? '#dc2626' : 'rgba(34,197,94,0.15)');
    const badgeColor = !hasModel ? '#a6adc8' : (isMini ? '#ffffff' : '#22c55e');
    const badgeBorder = !hasModel ? '1px solid rgba(108,112,134,0.25)' : (isMini ? '1px solid #dc2626' : '1px solid rgba(34,197,94,0.3)');
    console.log('🔄 renderLogoBadge:', modelName, isMini, 'retry:', retryCount);

    // ✅ 找模型选择器按钮（ChatGPT logo）
    const logoBtn = document.querySelector('button[aria-label="模型选择器"]');
    if (!logoBtn) {
        const nextRetry = (retryCount || 0) + 1;
        if (nextRetry > 15) {
            console.log('⏹️ 模型选择器按钮重试超时，停止');
            return;
        }
        console.log('⏳ 等待模型选择器按钮...');
        setTimeout(() => renderLogoBadge(modelName, isMini, nextRetry), 2000);
        return;
    }
    console.log('✅ 找到模型选择器按钮');

    // 检查是否已存在
    let container = document.getElementById('gpt-badge-container');
    if (container) {
        // 更新已有徽章
        const badge = container.querySelector('#gpt-logo-badge');
        if (badge) {
            badge.textContent = modelName;
            badge.style.background = badgeBg;
            badge.style.color = badgeColor;
            badge.style.border = badgeBorder;
        }
        updateDropdown(container);
        return;
    }

    console.log('🏗️ 创建徽章');
    container = document.createElement('div');
    container.id = 'gpt-badge-container';
    container.style.cssText = `
        display: inline-block;
        position: relative;
        margin-left: 8px;
        vertical-align: middle;
        cursor: pointer;
        pointer-events: auto;
        z-index: 10;
    `;

    const badge = document.createElement('span');
    badge.id = 'gpt-logo-badge';
    badge.style.cssText = `
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        font-family: system-ui, sans-serif;
        background: ${badgeBg};
        color: ${badgeColor};
        border: ${badgeBorder};
        transition: all 0.3s ease;
        user-select: none;
        line-height: 1.6;
        cursor: pointer;
        pointer-events: auto;
        white-space: nowrap;
    `;
    badge.textContent = modelName;

    if (isMini) {
        badge.style.animation = 'gpt-badge-pulse 1.5s ease-in-out infinite';
        if (!document.getElementById('gpt-badge-style')) {
            const style = document.createElement('style');
            style.id = 'gpt-badge-style';
            style.textContent = `
                @keyframes gpt-badge-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.05); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    const arrow = document.createElement('span');
    arrow.textContent = ' ▾';
    arrow.style.cssText = `font-size: 10px; opacity: 0.6; pointer-events: none;`;
    badge.appendChild(arrow);

    const dropdown = document.createElement('div');
    dropdown.id = 'gpt-history-dropdown';
    dropdown.style.cssText = `
        display: none;
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        width: 340px;
        background: #1e1e2f;
        border: 1px solid #313244;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
        z-index: 99999;
        font-family: -apple-system, system-ui, sans-serif;
        font-size: 13px;
        pointer-events: auto;
    `;

    if (!document.getElementById('gpt-dropdown-style')) {
        const style = document.createElement('style');
        style.id = 'gpt-dropdown-style';
        style.textContent = `
            #gpt-history-dropdown { user-select: text; -webkit-user-select: text; }
            #gpt-history-dropdown * { user-select: text; -webkit-user-select: text; }
            #gpt-history-dropdown::-webkit-scrollbar { width: 4px; }
            #gpt-history-dropdown::-webkit-scrollbar-track { background: #313244; border-radius: 4px; }
            #gpt-history-dropdown::-webkit-scrollbar-thumb { background: #6c7086; border-radius: 4px; }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(badge);
    container.appendChild(dropdown);

    // ✅ 放到 Logo 按钮右边（作为同级元素）
    logoBtn.parentElement.insertBefore(container, logoBtn.nextSibling);
    // 同时创建计数徽章
    renderCountBadge();
    console.log('✅ 徽章已添加到 Logo 按钮右侧');

    // 点击徽章切换下拉菜单
    badge.addEventListener('click', async function(e) {
        e.stopPropagation();
        e.preventDefault();
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) await updateDropdown(container);
    });

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', function(e) {
        if (container && e.target.isConnected && !container.contains(e.target)) {
            if (dropdown.style.display === 'block') dropdown.style.display = 'none';
        }
    });

    updateDropdown(container);
    console.log('✅ Logo 徽章已创建:', modelName);
}
// ====================================
// 渲染消息计数徽章（灰色标签，模型徽章右侧）
// ====================================
function renderCountBadge() {
    const now = Date.now();
    const ts3h = messageTimestamps.filter(t => now - t < 3 * 60 * 60 * 1000);
    const count = ts3h.length;

    let el = document.getElementById('gpt-count-badge');
    if (!el) {
        el = document.createElement('span');
        el.id = 'gpt-count-badge';
        const container = document.getElementById('gpt-badge-container');
        if (!container) return;
        container.parentElement.insertBefore(el, container.nextSibling);
    }

    let color, bg, border;
                    if (count >= 160) {
                        color = '#f38ba8'; bg = 'rgba(243,139,168,0.1)'; border = '1px solid rgba(243,139,168,0.3)';
                    } else if (count >= 100) {
                        color = '#f9e2af'; bg = 'rgba(249,226,175,0.1)'; border = '1px solid rgba(249,226,175,0.3)';
    } else {
        color = '#6c7086'; bg = 'transparent'; border = '1px solid rgba(108,112,134,0.25)';
    }

    el.style.cssText = `
        display: inline-block;
        margin-left: 6px;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
        font-family: system-ui, sans-serif;
        color: ${color};
        background: ${bg};
        border: ${border};
        user-select: none;
        line-height: 1.6;
        white-space: nowrap;
        vertical-align: middle;
        pointer-events: auto;
    `;
    el.textContent = `⏳ ${count} / 160`;
}
// ====================================
// 渲染"更多操作"旁边的徽章（每条消息）
// ====================================
function renderMoreButtonBadge(modelName, isMini, retryCount) {
    console.log('🔄 renderMoreButtonBadge:', modelName, isMini, 'retry:', retryCount);
    const buttons = document.querySelectorAll('button[aria-label="更多操作"]');
    
    if (buttons.length === 0) {
        const nextRetry = (retryCount || 0) + 1;
        if (nextRetry > 15) {
            console.log('⏹️ "更多操作"按钮重试超时，停止');
            return;
        }
        console.log('⏳ 等待"更多操作"按钮...');
        setTimeout(() => renderMoreButtonBadge(modelName, isMini, nextRetry), 2000);
        return;
    }

    const moreBtn = buttons[buttons.length - 1];
    console.log('✅ 找到最新"更多操作"按钮');

    // 检查是否已有徽章
    let existingDisplay = moreBtn.parentElement.querySelector('#gpt-display-el');
    if (existingDisplay) {
        existingDisplay.textContent = modelName;
        existingDisplay.style.background = isMini ? '#dc2626' : '#22c55e';
        if (isMini) {
            existingDisplay.style.animation = 'gpt-warning-pulse 1.5s ease-in-out infinite';
        } else {
            existingDisplay.style.animation = 'none';
        }
        console.log('✅ "更多操作"徽章已更新');
        return;
    }

    // 创建新徽章
    const displayEl = document.createElement('div');
    displayEl.id = 'gpt-display-el';
    displayEl.style.cssText = `
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        margin-left: 8px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        font-family: system-ui, sans-serif;
        transition: all 0.3s ease;
        user-select: none;
        background: ${isMini ? '#dc2626' : '#22c55e'};
        color: white;
    `;
    displayEl.textContent = modelName;

    if (isMini) {
        displayEl.style.animation = 'gpt-warning-pulse 1.5s ease-in-out infinite';
    }

    moreBtn.parentElement.insertBefore(displayEl, moreBtn.nextSibling);
    console.log('✅ "更多操作"徽章已创建:', modelName);
}
                // ====================================
                // 更新下拉历史列表
                // 和 popup 同步所有样式和功能
                // ====================================
                function showUsageInfoInDropdown() {
                    const d = document.getElementById('gpt-history-dropdown');
                    if (!d) return;
                    d.innerHTML = `
                        <div style="padding:12px 16px;font-size:13px;line-height:1.6;">
                            <div style="color:#89b4fa;font-size:15px;font-weight:600;margin:0 0 12px;">ℹ️ GPT-5.5 使用限制</div>
                            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #313244;">
                                <div style="color:#a6adc8;font-size:12px;">🆓 免费版</div>
                                <div style="color:#cdd6f4;"><span style="color:#f9e2af;">约10轮/5小时</span>，超标自动降 <span style="color:#f38ba8;">mini</span></div>
                            </div>
                            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #313244;">
                                <div style="color:#a6adc8;font-size:12px;">⭐ Plus/Go</div>
                                <div style="color:#cdd6f4;"><span style="color:#f9e2af;">160轮/3小时</span>，超标自动降 <span style="color:#f38ba8;">mini</span></div>
                                <div style="color:#585b70;font-size:11px;margin-top:1px;">≈53轮/小时 ≈0.88轮/分钟</div>
                            </div>
                            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #313244;">
                                <div style="color:#a6adc8;font-size:12px;">🧠 Thinking 模式</div>
                                <div style="color:#cdd6f4;">Plus 手动选;<span style="color:#f9e2af;">Go 10轮/5小时</span></div>
                            </div>
                            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #313244;">
                                <div style="color:#a6adc8;font-size:12px;">💡 推测</div>
                                <div style="color:#cdd6f4;">额度是逐条恢复，不是到点重置</div>
                            </div>
                            <div style="margin-bottom:0;">
                                <div style="color:#f38ba8;font-weight:500;">⚠️ 作者实测</div>
                                <div style="color:#cdd6f4;">不稳定的网络环境（VPN/节点）和要求 GPT 进行大量编码会大量消耗额度，导致降智</div>
                            </div>
                            <div style="text-align:center;padding-top:8px;border-top:1px solid #313244;margin-top:10px;">
                                <button data-action="back-to-dropdown" style="width:100%;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#313244;color:#cdd6f4;">← 返回</button>
                            </div>
                        </div>
                    `;
                    d.querySelector('[data-action="back-to-dropdown"]')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const c = document.getElementById('gpt-badge-container');
                        if (c) updateDropdown(c);
                    });
                }

                async function updateDropdown(container) {
                    const dropdown = container?.querySelector('#gpt-history-dropdown') || document.getElementById('gpt-history-dropdown');
                    if (!dropdown) return;

                    // 使用本地缓存的 timestamps
                    const now = Date.now();
                    const ts3h = messageTimestamps.filter(t => now - t < 3 * 60 * 60 * 1000);
                    const ts24h = messageTimestamps.filter(t => now - t < 24 * 60 * 60 * 1000);

                    const count3hColor = ts3h.length >= 160 ? '#f38ba8' : ts3h.length >= 100 ? '#f9e2af' : '#a6e3a1';

                    // 当前模型持续轮数和持续时间（turns 由 updateModel 实时维护）
                    let currentTurns = 0, currentDurMs = 0;
                    if (currentModel && modelHistory.length > 0 && modelHistory[0].model === currentModel && modelHistory[0].timestamp) {
                        currentTurns = modelHistory[0].turns || 0;
                        currentDurMs = Date.now() - modelHistory[0].timestamp;
                    }
                    const currentDurStr = formatDuration(currentDurMs);

                    // 状态
                    const isMiniStatus = currentModel ? currentModel.toLowerCase().includes('mini') : false;
                    const statusDotColor = isMiniStatus ? '#f38ba8' : currentModel ? '#a6e3a1' : '#6c7086';
                    const statusText = isMiniStatus ? '⚠️ 已降智' : currentModel ? '✅ 正常' : '未检测';


                    // 模型徽章样式
                    const badgeBg = isMiniStatus ? '#f38ba8' : currentModel ? '#a6e3a1' : '#313244';
                    const badgeColor = isMiniStatus || currentModel ? '#1e1e2f' : '#a6adc8';
                    const badgeText = currentModel || '未检测';

                    // 当前模型开始时间
                    let startTimeStr = '';
                    if (currentModel && modelHistory.length > 0 && modelHistory[0].model === currentModel && modelHistory[0].time) {
                        startTimeStr = modelHistory[0].time;
                    }
                    const modelColor = isMiniStatus ? '#f38ba8' : '#a6e3a1';
                    const modelEmoji = isMiniStatus ? '🔴' : '🟢';

                    // 历史记录列表（跳过当前模型）
                    let historyHtml = '';
                    if (!modelHistory || modelHistory.length === 0 || (modelHistory.length === 1 && modelHistory[0].model === currentModel)) {
                        historyHtml = `<div style="padding:8px 0;color:#6c7086;text-align:center;font-size:12px;">暂无切换记录</div>`;
                    } else {
                        historyHtml = modelHistory.map((item, index) => {
                            const isMini = item.model.toLowerCase().includes('mini');
                            const isCurrent = item.model === currentModel && index === 0;
                            if (isCurrent) return '';
                            const turnsStr = item.turns != null ? item.turns : '-';
                            const durStr = formatDuration(item.duration);
                            const c = isMini ? '#f38ba8' : '#a6e3a1';
                            const emoji = isMini ? '🔴' : '🟢';
                            return `
                                <div style="padding:6px 0;border-bottom:1px solid #313244;">
                                    <div style="font-size:13px;font-weight:500;color:${c};">${emoji} ${item.model}</div>
                                    <div style="font-size:12px;color:#cdd6f4;margin-top:2px;">${turnsStr}轮 | ${durStr}</div>
                                    <div style="font-size:11px;color:#6c7086;margin-top:1px;">📌 ${item.time}</div>
                                </div>
                            `;
                        }).filter(Boolean).join('');
                    }

                    const ts1h = messageTimestamps.filter(t => now - t < 60 * 60 * 1000);
                    const count1h = ts1h.length;
                    const statusEmoji = count1h <= 29 ? '🟢' : count1h <= 53 ? '🟡' : count1h <= 79 ? '🟠' : '🔴';

                    const lastTs = messageTimestamps.length > 0 ? messageTimestamps[messageTimestamps.length - 1] : null;
                    let activeTimeStr = '暂无';
                    if (lastTs) {
                        const diff = now - lastTs;
                        if (diff < 60000) activeTimeStr = '刚刚';
                        else if (diff < 3600000) activeTimeStr = `${Math.floor(diff / 60000)}分钟前`;
                        else {
                            const h = Math.floor(diff / 3600000);
                            const m = Math.floor((diff % 3600000) / 60000);
                            activeTimeStr = `${h}小时${m}分钟前`;
                        }
                    }

                    function fmtRemaining(ms) {
                        if (ms <= 0) return '0m';
                        const totalMin = Math.floor(ms / 60000);
                        if (totalMin < 60) return `${totalMin}m`;
                        const h = Math.floor(totalMin / 60);
                        const m = totalMin % 60;
                        return m > 0 ? `${h}h${m}m` : `${h}h`;
                    }
                    function fmtClock(ts) {
                        const d = new Date(ts);
                        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    }

                    let recoveryHtml = '';
                    if (ts3h.length === 0) {
                        recoveryHtml = `
                            <div style="color:#585b70;font-size:12px;padding:6px 0;border-bottom:1px solid #313244;">
                                <div style="font-weight:500;color:#6c7086;margin-bottom:4px;">⌛ 恢复预测</div>
                                <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#cdd6f4;">+1</span><span style="color:#585b70;">—</span></div>
                                <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#cdd6f4;">+10</span><span style="color:#585b70;">—</span></div>
                                <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#cdd6f4;">✓</span><span style="color:#585b70;">—</span></div>
                            </div>`;
                    } else {
                        const sorted = [...ts3h].sort((a, b) => a - b);
                        const t1 = sorted[0] + 3 * 60 * 60 * 1000;
                        const r1 = Math.max(0, t1 - now);
                        const r1Str = fmtRemaining(r1);
                        const t1Clock = fmtClock(t1);

                        let r10Str = '—', t10Clock = '';
                        if (sorted.length >= 10) {
                            const t10 = sorted[9] + 3 * 60 * 60 * 1000;
                            r10Str = fmtRemaining(Math.max(0, t10 - now));
                            t10Clock = fmtClock(t10);
                        }

                        const tAll = sorted[sorted.length - 1] + 3 * 60 * 60 * 1000;
                        const rAllStr = fmtRemaining(Math.max(0, tAll - now));
                        const tAllClock = fmtClock(tAll);

                        recoveryHtml = `
                            <div style="color:#585b70;font-size:12px;padding:6px 0;border-bottom:1px solid #313244;">
                                <div style="font-weight:500;color:#6c7086;margin-bottom:4px;">⌛ 恢复预测</div>
                                <div style="display:flex;padding:2px 0;"><span style="color:#cdd6f4;width:30px;">+1</span><span style="color:#cdd6f4;flex:1;text-align:right;">${r1Str}</span><span style="color:#585b70;text-align:right;width:70px;">(${t1Clock})</span></div>
                                <div style="display:flex;padding:2px 0;"><span style="color:#cdd6f4;width:30px;">+10</span><span style="color:#cdd6f4;flex:1;text-align:right;">${r10Str}</span><span style="color:#585b70;text-align:right;width:70px;">${r10Str !== '—' ? `(${t10Clock})` : ''}</span></div>
                                <div style="display:flex;padding:2px 0;"><span style="color:#cdd6f4;width:30px;">✓</span><span style="color:#cdd6f4;flex:1;text-align:right;">${rAllStr}</span><span style="color:#585b70;text-align:right;width:70px;">(${tAllClock})</span></div>
                            </div>`;
                    }

                    dropdown.innerHTML = `
                        <div style="padding:12px 16px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #313244;padding-bottom:8px;">
                                <span style="font-size:15px;color:#89b4fa;font-weight:bold;">🐱GPT-Monitor</span>
                                <span data-action="usage-info" style="cursor:pointer;font-size:16px;color:#6c7086;user-select:none;line-height:1;">ⓘ</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #313244;align-items:flex-start;">
                                <div>
                                    <div style="font-size:14px;font-weight:600;color:${modelColor};">${modelEmoji} ${badgeText}</div>
                                    <div style="font-size:12px;color:#cdd6f4;margin-top:3px;">${currentTurns}轮 | ${currentDurStr}</div>
                                    <div style="font-size:12px;color:#6c7086;margin-top:2px;">🕒 活跃 ${activeTimeStr}</div>
                                    <div style="font-size:11px;color:#585b70;margin-top:2px;">📌 ${startTimeStr}</div>
                                </div>
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
                                            <span style="font-weight:600;color:${count3hColor};">${ts3h.length}</span>
                                            <span style="color:#6c7086;font-size:11px;"> / 160</span>
                                        </span>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                                        <span>📅 近24h</span>
                                        <span style="font-weight:600;color:#cdd6f4;">${ts24h.length}</span>
                                    </div>
                                </div>
                            </div>
                            ${recoveryHtml}
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #313244;">
                                <span style="font-size:12px;color:#6c7086;">☁️ 云端有消息更新时自动刷新</span>
                                <input type="checkbox" id="cs-autorefresh" style="accent-color:#89b4fa;width:16px;height:16px;cursor:pointer;">
                            </div>
                            <div style="color:#585b70;font-size:11px;padding:6px 0;">模型切换历史</div>
                            <div style="max-height:220px;overflow-y:auto;">
                                ${historyHtml}
                            </div>
                            <div style="display:flex;gap:8px;padding-top:8px;border-top:1px solid #313244;">
                                <button data-action="test-toggle" style="flex:1;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#89b4fa;color:#1e1e2f;">🔬 测试</button>
                                <button data-action="clear-history" style="flex:1;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#313244;color:#cdd6f4;">🗑️ 清除监控数据</button>
                            </div>
                        </div>
                    `;

                    // 用 addEventListener 绑定动作
                    dropdown.querySelector('[data-action="usage-info"]')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showUsageInfoInDropdown();
                    });
                    dropdown.querySelector('[data-action="clear-history"]')?.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!confirm('确认清除监控数据？\n\n将删除：\n• 当前模型状态\n• 模型切换历史\n• 近3h消息统计\n• 近24h消息统计\n\n该操作不可撤销。')) return;
                        messageTimestamps = [];
                        modelHistory = [];
                        currentModel = null;
                        detected = false;
                        await saveToStorage({ messageTimestamps: [], modelHistory: [], currentModel: null, detected: false });
                        // 移除 UI 元素
                        document.getElementById('gpt-badge-container')?.remove();
                        document.getElementById('gpt-count-badge')?.remove();
                        document.getElementById('gpt-display-el')?.remove();
                        document.getElementById('gpt-model-banner')?.remove();
                        renderCountBadge();
                        await updateDropdown(container);
                    });
                    dropdown.querySelector('[data-action="test-toggle"]')?.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        testToggle = !testToggle;
                        const model = testToggle ? 'gpt-test-mini' : 'gpt-test';
                        await updateModel(model);
                    });

                    // CloudSync Auto Refresh 开关
                    var csToggleEl = document.getElementById('cs-autorefresh');
                    if (csToggleEl) {
                        await fetchCloudSyncState();
                        csToggleEl.checked = cloudsyncAutoRefresh;
                        csToggleEl.addEventListener('change', function(e) {
                            e.stopPropagation();
                            window.postMessage({
                                type: 'SET_STORAGE',
                                data: { 'cloudsync:autoRefresh': e.target.checked },
                                target: 'storage'
                            }, '*');
                        });
                    }
                }

                // ====================================
                // 更新模型（内存 + storage + UI）
                // ====================================
                async function updateModel(modelName) {
                    const isMini = modelName.toLowerCase().includes('mini');

                    console.log(`🐛 [${_ts()}] [${_iid}] [updateModel] modelName:${modelName} currentModel:${currentModel} isMini:${isMini}`);

                    if (modelName === currentModel) {
                        // turns 由 updateModel() 实时维护。
                        // 每次成功解析到 resolved_model_slug 视为完成一轮回复。
                        // 不依赖 messageTimestamps，避免跨 24h 后统计失真。
                        if (modelHistory.length > 0) {
                            modelHistory[0].turns = (modelHistory[0].turns || 0) + 1;
                            await saveToStorage({ modelHistory });
                        }
                        console.log(`ℹ️ [${_ts()}] [${_iid}] 模型未变化:`, modelName);
                        // 重绘徽章，防止被 React 重新渲染清除
                        renderLogoBadge(modelName, isMini);
                        renderMoreButtonBadge(modelName, isMini);
                        renderCountBadge();
                        return;
                    }

                    console.log(`🔄 [${_ts()}] [${_iid}] 模型变化: ${currentModel} → ${modelName}`);

                    const now = new Date();
                    const timeStr = now.toLocaleString('zh-CN', {
                        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
                    });

                    // ✅ 计算旧模型的持续时间（turns 已由 updateModel 实时维护，不再重算）
                    if (currentModel && modelHistory.length > 0 && modelHistory[0].model === currentModel) {
                        modelHistory[0].duration = Date.now() - modelHistory[0].timestamp;
                    }

                    // ✅ 更新内存（每次 SSE 解析到新模型，视为该模型的第一轮完成）
                    currentModel = modelName;
                    modelHistory.unshift({ model: modelName, time: timeStr, timestamp: now.getTime(), turns: 1, duration: 0 });
                    if (modelHistory.length > 50) modelHistory = modelHistory.slice(0, 50);

                    // ✅ 更新 UI
                    renderLogoBadge(modelName, isMini);
                    renderMoreButtonBadge(modelName, isMini);
                    // ✅ 每次切换都显示横幅
                    showBanner(modelName, isMini);

                    // ✅ 写入 storage（同时同步 timestamps）
                    await saveToStorage({ currentModel: modelName, modelHistory: modelHistory });
                    renderCountBadge();
                    console.log(`✅ [${_ts()}] [${_iid}] 模型已更新:`, modelName);
                }

                // ====================================
                // 拦截 fetch
                // ====================================
                const originalFetch = window.fetch;
                window.fetch = function(...args) {
                    const url = args[0];
                    const urlStr = typeof url === 'string' ? url : url?.url || '';

                    if (typeof urlStr === 'string' && urlStr.includes('/backend-api/f/conversation')) {
                        console.log(`🎯 [${_ts()}] [${_iid}] fetch 拦截到 conversation`);

                        return originalFetch.apply(this, args).then(async (response) => {
                            const cloned = response.clone();
                            const reader = cloned.body.getReader();
                            const decoder = new TextDecoder('utf-8');
                            let buffer = '';
                            let resolvedModel = null;
                            let seenModelField = false;

                            function readStream() {
                                reader.read().then(({ done, value }) => {
                                    if (done) {
                                        if (resolvedModel) {
                                            console.log(`📡 [${_ts()}] [${_iid}] SSE 结束, resolvedModel: ${resolvedModel}`);
                                            setTimeout(() => updateModel(resolvedModel), 500);
                                        } else if (seenModelField) {
                                            console.log(`📡 [${_ts()}] [${_iid}] SSE 结束, model unresolved (seen model field but no slug)`);
                                        } else {
                                            console.log(`📡 [${_ts()}] [${_iid}] SSE 结束, model unresolved (no model field in stream)`);
                                        }
                                        return;
                                    }

                                    const chunk = decoder.decode(value, { stream: true });
                                    buffer += chunk;
                                    const lines = buffer.split('\n');
                                    buffer = lines.pop() || '';

                                    for (const line of lines) {
                                        if (line.startsWith('data: ')) {
                                            try {
                                                const jsonStr = line.slice(6);
                                                if (jsonStr === '[DONE]') continue;
                                                const data = JSON.parse(jsonStr);

                                                let model = null;

                                                // 1) delta 事件: v.message.metadata 中的 model_slug
                                                //    这是 assistant 实际生成当前回复的模型，优先级最高
                                                if (data.v?.message?.metadata) {
                                                    model = data.v.message.metadata.model_slug || data.v.message.metadata.resolved_model_slug || null;
                                                }
                                                // 2) 仅在还没有模型时，才从其他来源补充
                                                if (!model && !resolvedModel) {
                                                    if (data.type === 'server_ste_metadata' && data.metadata?.model_slug) {
                                                        model = data.metadata.model_slug;
                                                    } else if (data.metadata) {
                                                        model = data.metadata.resolved_model_slug || data.metadata.model_slug || null;
                                                    }
                                                }

                                                if (data.metadata || data.v?.message?.metadata) {
                                                    seenModelField = true;
                                                }

                                                if (model) {
                                                    resolvedModel = model;
                                                    console.log(`🎯 [${_ts()}] [${_iid}] 读到模型:`, model);
                                                }
                                            } catch (e) {}
                                        }
                                    }
                                    readStream();
                                });
                            }
                            readStream();
                            return response;
                        });
                    }
                    return originalFetch.apply(this, args);
                };

                // ====================================
                // 启动提示
                // ====================================
                function showStartupTip() {
                    const existing = document.getElementById('gpt-startup-tip');
                    if (existing) existing.remove();

                    const tip = document.createElement('div');
                    tip.id = 'gpt-startup-tip';
                    tip.style.cssText = `
                        position: fixed; top: 0; left: 0; right: 0; z-index: 999990;
                        background: rgba(34,197,94,0.12);
                        backdrop-filter: blur(8px);
                        color: #22c55e;
                        padding: 8px 20px;
                        text-align: center;
                        font-size: 14px;
                        font-weight: 500;
                        font-family: system-ui, sans-serif;
                        border-bottom: 1px solid rgba(34,197,94,0.15);
                        transition: opacity 0.6s ease, transform 0.6s ease;
                        opacity: 1;
                        transform: translateY(0);
                        pointer-events: none;
                        user-select: none;
                        letter-spacing: 0.3px;
                    `;
                    tip.innerHTML = `
                        <span style="display:inline-flex;align-items:center;gap:8px;">
                            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;animation:gpt-dot-pulse 1.2s ease-in-out infinite;"></span>
                            🔍 模型监控已启动
                        </span>
                    `;
                    document.body.prepend(tip);

                    if (!document.getElementById('gpt-tip-style')) {
                        const style = document.createElement('style');
                        style.id = 'gpt-tip-style';
                        style.textContent = `
                            @keyframes gpt-dot-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.7)} }
                        `;
                        document.head.appendChild(style);
                    }

                    setTimeout(() => {
                        tip.style.opacity = '0';
                        tip.style.transform = 'translateY(-20px)';
                        setTimeout(() => { if (tip.parentNode) tip.remove(); }, 600);
                    }, 1000);
                }

                // ====================================
                // 暴露调试接口
                // ====================================
                window.__modelMonitor = {
                    test: function() {
                        console.log('🧪 手动测试');
                        updateModel('gpt-test-mini');
                    },
                    setModel: function(name) {
                        console.log('🧪 手动设置模型:', name);
                        updateModel(name);
                    },
                    reset: function() {
                        detected = false;
                        document.getElementById('gpt-model-banner')?.remove();
                        saveToStorage({ detected: false });
                        console.log('🔄 已重置');
                    },
                    status: function() {
                        console.log({ currentModel, historyCount: modelHistory.length, detected });
                    },
                    __refreshDropdown: async function() {
                        const c = document.getElementById('gpt-badge-container');
                        if (c) await updateDropdown(c);
                    }
                };

                // ====================================
                // 监听 SPA 路由变化
                // ====================================
                let _lastUrl = location.href;
                function _checkBadgeAfterNav() {
                    const cur = location.href;
                    if (cur === _lastUrl) return;
                    _lastUrl = cur;
                    console.log(`🔄 URL 变化: ${cur}`);
                    setTimeout(() => {
                        if (!document.getElementById('gpt-badge-container')) {
                            const name = currentModel || 'GPT-Monitor';
                            const mini = currentModel ? currentModel.toLowerCase().includes('mini') : false;
                            renderLogoBadge(name, mini);
                            if (currentModel) renderMoreButtonBadge(currentModel, mini);
                        }
                    }, 2000);
                }
                const _origPush = history.pushState.bind(history);
                const _origReplace = history.replaceState.bind(history);
                history.pushState = function(...a) { _origPush(...a); _checkBadgeAfterNav(); };
                history.replaceState = function(...a) { _origReplace(...a); _checkBadgeAfterNav(); };
                window.addEventListener('popstate', _checkBadgeAfterNav);

                // ====================================
                // 启动
                // ====================================
                showStartupTip();

                {
                    const displayName = currentModel || 'GPT-Monitor';
                    const isMini = currentModel ? currentModel.toLowerCase().includes('mini') : false;
                    renderLogoBadge(displayName, isMini);
                    if (currentModel) renderMoreButtonBadge(currentModel, isMini);
                }

                // 尝试创建计数徽章（即使没有模型数据也显示）
                setTimeout(renderCountBadge, 500);

                // 读取 CloudSync 初始状态
                fetchCloudSyncState();

                console.log('✅ SSE 拦截器已安装');
                console.log('💡 调试: window.__modelMonitor.test()');
                console.log('💡 调试: window.__modelMonitor.reset()');
                console.log('💡 调试: window.__modelMonitor.status()');
            },
            args: [storageData]
        });
    }).catch(err => console.error('❌ 注入失败:', err));
}

// ============================================
// 注入拦截器（检查页面主世界）
// ============================================
function injectInterceptor(tabId) {
    console.log('💉 injectInterceptor 被调用, tabId:', tabId);

    chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: function() {
            return typeof window.__modelMonitor !== 'undefined';
        }
    }).then((results) => {
        const alreadyInjected = results && results[0] && results[0].result;
        if (alreadyInjected) {
            console.log('⏭️ 页面主世界已有 __modelMonitor，跳过注入');
            return;
        }
        console.log('🔄 页面主世界无 __modelMonitor，执行注入');
        doInject(tabId);
    }).catch((err) => {
        console.log('🔄 检查失败，执行注入, err:', err);
        doInject(tabId);
    });
}

// ============================================
// 消息处理（background 备用）
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Background 收到消息:', message.type);

    if (message.type === 'PING') {
        sendResponse({ pong: true });
        return true;
    }

    if (message.type === 'GET_STATUS') {
        sendResponse({ detected: detected });
        return true;
    }

    if (message.type === 'ADD_HISTORY') {
        const model = message.data?.model || message.model;
        if (model) {
            addHistory(model);
            sendResponse({ done: true });
        } else {
            sendResponse({ done: false });
        }
        return true;
    }

    if (message.type === 'RESET_DETECTED') {
        detected = false;
        chrome.storage.local.set({ detected: false });
        sendResponse({ done: true });
        return true;
    }

    if (message.type === 'CLEAR_MESSAGE_TIMESTAMPS') {
        chrome.storage.local.set({ messageTimestamps: [] });
        sendResponse({ done: true });
        return true;
    }
});

// ============================================
// webRequest 拦截
// ============================================
chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        if (details.url.includes('/backend-api/f/conversation')) {
            console.log('🎯 [webRequest] 拦截到 conversation, tabId:', details.tabId);
            recordMessage();
            if (details.tabId > 0) {
                currentTabId = details.tabId;
                injectInterceptor(currentTabId);
            }
        }
        return { cancel: false };
    },
    { urls: ["https://chatgpt.com/backend-api/f/conversation"] },
    ["requestBody"]
);

// ============================================
// 加载存储状态
// ============================================
async function loadDetected() {
    const result = await chrome.storage.local.get(['detected']);
    detected = result.detected || false;
    console.log('📦 加载检测状态:', detected);
}
loadDetected();

// ============================================
// Tab 管理
// ============================================
chrome.tabs.onActivated.addListener((activeInfo) => {
    currentTabId = activeInfo.tabId;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url?.includes('chatgpt.com')) {
        console.log('🔄 页面加载中，清除标记, tabId:', tabId);
        injectedTabs.delete(tabId);
    }

    if (changeInfo.status === 'complete' && tab.url?.includes('chatgpt.com')) {
        console.log('🔄 Tab 更新完成:', tabId);
        currentTabId = tabId;
        setTimeout(() => injectInterceptor(tabId), 1500);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
});

console.log('✅ background 已就绪');