// token.js
// ============================================
// TokenManager — 内存 Token 管理
// ============================================

class TokenManager {
    constructor() {
        this.token = null;
    }

    setToken(token) {
        if (this.token === token) return false;
        this.token = token;
        return true;
    }

    getToken() {
        return this.token;
    }

    clearToken() {
        this.token = null;
    }

    hasToken() {
        return this.token !== null;
    }
}
