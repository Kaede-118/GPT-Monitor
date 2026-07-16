// utils/chatgpt.js
// ============================================
// ChatGPT URL 解析工具
// ============================================

function getCurrentConversationId(url) {
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
}
