// inject.js (MAIN world)
// ============================================
// Hook window.fetch — SSE 流解析，提取本地 assistant message id
// Hook window.WebSocket — 监听 WS，比对 message_id 过滤本地消息
// Hook history API — 捕获 SPA URL 变化
// ============================================

(function () {
    // 时间戳日志（UTC+8）
    function ts() {
        var d = new Date();
        var ms = d.getTime() + 8 * 3600000;
        return new Date(ms).toISOString().slice(11, 23);
    }
    var origLog = console.log;
    var origWarn = console.warn;
    function cLog() {
        origLog.apply(console, ['[' + ts() + ']'].concat(Array.prototype.slice.call(arguments)));
    }
    function cWarn() {
        origWarn.apply(console, ['[' + ts() + ']'].concat(Array.prototype.slice.call(arguments)));
    }
    function debugLog(msg) {
        var text = '[' + ts() + '] ' + msg;
        origLog.apply(console, [text]);
        try { window.postMessage({ type: 'cloudsync-debug', text: text }, '*'); } catch (e) {}
    }
    console.log = cLog;
    console.warn = cWarn;

    cLog('[CloudSync] inject.js 已加载');

    // ============================================
    // 本地消息 ID 集合 — 从 SSE 流中提取
    // ============================================
    var localMessageIds = new Set();
    var sseStreamEndTime = 0;
    var sseStreamActive = false;

    // ============================================
    // SSE 解析 — 从 SSE data 中提取 assistant message id
    // ============================================
    function tryExtractAssistantId(data) {
        try {
            var obj = JSON.parse(data);
            if (obj.o === 'add' && obj.v && obj.v.message && obj.v.message.author) {
                if (obj.v.message.author.role === 'assistant' && obj.v.message.id) {
                    localMessageIds.add(obj.v.message.id);
                    debugLog('SSE assistant_message id=' + obj.v.message.id);
                    try { window.postMessage({ type: 'cloudsync-local-sync' }, '*'); } catch (e) {}
                    if (localMessageIds.size > 20) {
                        var first = localMessageIds.values().next().value;
                        localMessageIds.delete(first);
                    }
                }
            }
        } catch (e) {}
    }

    function tryExtractUserMessage(data) {
        try {
            var obj = JSON.parse(data);
            if (obj && obj.type === 'input_message' && obj.input_message) {
                var m = obj.input_message;
                var snippet = m.content && m.content.parts && m.content.parts[0] ? m.content.parts[0].slice(0, 80) : '';
                debugLog('SSE user_message id=' + (m.id || '?') + ' content="' + snippet + '"');
            }
        } catch (e) {}
    }

    // ============================================
    // SSE 流读取 — 累积 buffer，按 \n\n 分割事件
    // ============================================
    function readSSEStream(reader) {
        var buffer = '';

        function processBuffer() {
            var parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (var i = 0; i < parts.length; i++) {
                var block = parts[i].trim();
                if (!block) continue;
                var lines = block.split('\n');
                var eventType = '';
                var data = '';
                for (var j = 0; j < lines.length; j++) {
                    var line = lines[j];
                    if (line.indexOf('event: ') === 0) {
                        eventType = line.slice(7);
                    } else if (line.indexOf('data: ') === 0) {
                        data = line.slice(6);
                    }
                }
                if (data) {
                    if (eventType === 'input_message' || /"type"\s*:\s*"input_message"/.test(data)) {
                        tryExtractUserMessage(data);
                    } else {
                        tryExtractAssistantId(data);
                    }
                }
            }
        }

        sseStreamActive = true;

        function read() {
            return reader.read().then(function (result) {
                if (result.done) {
                    sseStreamEndTime = Date.now();
                    sseStreamActive = false;
                    try { window.postMessage({ type: 'cloudsync-sse-complete' }, '*'); } catch (e) {}
                    return;
                }
                buffer += new TextDecoder().decode(result.value);
                processBuffer();
                return read();
            });
        }

        read().catch(function () {
            sseStreamEndTime = Date.now();
            sseStreamActive = false;
            try { window.postMessage({ type: 'cloudsync-sse-complete' }, '*'); } catch (e) {}
        });
    }

    // ============================================
    // Hook fetch — 捕获 Bearer Token + SSE 解析
    // ============================================
    var lastToken = null;

    function notifyToken(token) {
        window.postMessage({ type: 'cloudsync-token', token: token }, '*');
    }

    function extractBearerToken(init) {
        if (!init || !init.headers) return null;
        var headers = init.headers;

        if (typeof headers.get === 'function') {
            var auth = headers.get('Authorization');
            if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
        }

        if (typeof headers === 'object' && !Array.isArray(headers)) {
            var auth = headers['Authorization'] || headers['authorization'];
            if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
        }

        return null;
    }

    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
        var token = extractBearerToken(init);
        if (token && token !== lastToken) {
            lastToken = token;
            notifyToken(token);
        }

        var p = originalFetch.apply(this, arguments);

        p = p.then(function (response) {
            var ct = (response.headers.get('Content-Type') || '').toLowerCase();
            if (ct.indexOf('text/event-stream') !== -1) {
                readSSEStream(response.clone().body.getReader());
            }
            return response;
        });

        return p;
    };

    cLog('[CloudSync] fetch + SSE 解析 Hook 已安装');

    // ============================================
    // Hook WebSocket — 监听 WS，比对 message_id
    // ============================================
    var originalWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
        var ws = new originalWebSocket(url, protocols);

        if (typeof url === 'string' && url.indexOf('wss://ws.chatgpt.com/') === 0) {
            ws.addEventListener('message', function (event) {
                try {
                    var parsed = JSON.parse(event.data);
                    var messages = Array.isArray(parsed) ? parsed : [parsed];
                    for (var i = 0; i < messages.length; i++) {
                        // conversation-update — 比对 message_id 过滤本地消息
                        if (messages[i].type === 'conversation-update') {
                            var msg = messages[i].payload &&
                                      messages[i].payload.update_content &&
                                      messages[i].payload.update_content.message;

                            if (msg) {
                                var snippet = msg.content && msg.content.parts && msg.content.parts[0] ? msg.content.parts[0].slice(0, 60) : '';
                                var isLocal = msg.id && localMessageIds.has(msg.id);
                                var recentSSE = Date.now() - sseStreamEndTime < 15000;
                                var skip = isLocal || recentSSE;
                                var model = msg.metadata && msg.metadata.model_slug || '';
                                debugLog('WS conversation-update id=' + msg.id + ' role=' + (msg.author && msg.author.role) + ' status=' + msg.status + ' model=' + model + (skip ? ' LOCAL_SKIP' : '') + ' content="' + snippet + '"');
                                if (skip) continue;
                            }

                            window.postMessage({ type: 'cloudsync-ws-event', data: messages[i] }, '*');
                            continue;
                        }

                        // conversation-turn-complete — 无 SSE 活动且结束超 30 秒的才视为远端
                        if (messages[i].type === 'message' &&
                            messages[i].payload &&
                            messages[i].payload.type === 'conversation-turn-complete') {
                            var convId = messages[i].payload.payload && messages[i].payload.payload.conversation_id;
                            var recentEnd = sseStreamEndTime !== 0 && Date.now() - sseStreamEndTime < 30000;
                            var idle = !sseStreamActive && !recentEnd;
                            debugLog('WS conversation-turn-complete conv=' + convId + (idle ? ' -> OUTDATED' : ' BLOCKED'));
                            if (!idle) continue;
                            window.postMessage({ type: 'cloudsync-ws-turn-complete', conversation_id: convId }, '*');
                            continue;
                        }
                    }
                } catch (e) {}
            });
        }

        return ws;
    };
    window.WebSocket.prototype = originalWebSocket.prototype;

    cLog('[CloudSync] WebSocket + message_id 过滤 Hook 已安装');

    // ============================================
    // Hook history API — 捕获 SPA URL 变化
    // ============================================
    function notifyUrlChanged() {
        window.postMessage({ type: 'cloudsync-url-change', url: location.href }, '*');
    }

    var origPushState = history.pushState;
    var origReplaceState = history.replaceState;

    history.pushState = function () {
        origPushState.apply(this, arguments);
        notifyUrlChanged();
    };

    history.replaceState = function () {
        origReplaceState.apply(this, arguments);
        notifyUrlChanged();
    };

    window.addEventListener('popstate', notifyUrlChanged);
})();
