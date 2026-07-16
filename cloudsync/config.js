// config.js
// ============================================
// CloudSync 默认配置
// ============================================

// 时间戳日志（UTC+8，background 所有模块共用）
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

class CloudSyncConfig {
    static STORAGE_KEY = 'cloudsync';
    static AUTO_REFRESH_KEY = 'cloudsync:autoRefresh';
}
