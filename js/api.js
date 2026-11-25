// switch from local to live host
const API_URL = "https://vanalytics.onrender.com";

// ── Client-side response cache 
// Prevents redundant API calls when navigating between pages.
// TTL: 60 seconds for most endpoints, invalidated on sync.

const _cache = {};
const _CACHE_TTL = 60 * 1000; // 60 seconds

function _cacheGet(key){
    const item = _cache[key];
    if(!item) return null;
    if(Date.now() - item.ts > _CACHE_TTL){
        delete _cache[key];
        return null;
    }
    return item.data;
}

function _cacheSet(key, data){
    _cache[key] = { data, ts: Date.now() };
}

function _cacheInvalidate(){
    Object.keys(_cache).forEach(k => delete _cache[k]);
}


// ── Restore accent colour preference ─────────────────────
const _savedAccent = localStorage.getItem("voyager_accent");
if(_savedAccent){
    document.documentElement.style.setProperty("--primary", _savedAccent);
}

// ── Restore light/dark mode preference ───────────────────
const _savedMode = localStorage.getItem("voyager_theme");
if(_savedMode === "light"){
    document.documentElement.classList.add("light");
}

async function authFetch(url, options = {}){
    const res = await fetch(url, options);

    if(res.status === 401){
        return {
            ok: false,
            status: 401,
            json: async () => ({ error: "Session expired. Please log in again." })
        };
    }

    return res;
}

// ── Active account management ──────────
function getActiveAccountId(){
    return localStorage.getItem("voyager_active_account") || null;
}

function setActiveAccountId(id){
    if(id){
        localStorage.setItem("voyager_active_account", id);
    } else {
        localStorage.removeItem("voyager_active_account");
    }
}

function activeAccountParam(){
    const id = getActiveAccountId();
    return id ? `?account_id=${id}` : "";
}



// API functions
// Register a new user
async function registerUser(userData) {

    const response = await fetch(
        `${API_URL}/register`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(userData)
        }
    );

    return response.json();
}
 
// Log in an existing user
async function loginUser(userData) {

    const response = await fetch(
        `${API_URL}/login`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(userData)
        }
    );

    return response.json();
}


// ── Premium check 

async function checkPremium(){
    try {
        const res  = await fetch(`${API_URL}/auth/me`, {
            headers: { "Authorization": `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        return data.is_premium || false;
    } catch {
        return false;
    }
}

// For future use — call this to gate a feature
// Pass the element to hide/show and a message
async function requirePremium(containerEl, tier = "Starter"){
    const isPremium = await checkPremium();

    if(!isPremium){
        containerEl.innerHTML = `
            <div style="
                text-align: center;
                padding: 80px 20px;
                color: var(--muted);
            ">
                <div style="
                    font-size: 3rem;
                    margin-bottom: 16px;
                ">🔒</div>
                <h3 style="color: white; margin-bottom: 10px;">
                    ${tier} Feature
                </h3>
                <p style="
                    font-size: 14px;
                    max-width: 400px;
                    margin: 0 auto 24px;
                    line-height: 1.7;
                ">
                    This feature is available on the
                    <strong style="color: #00d4ff;">${tier}</strong>
                    plan and above. Upgrade to unlock it.
                </p>
                <a href="../index.html#pricing" class="btn-primary" style="
                    padding: 12px 28px;
                    border-radius: 10px;
                    text-decoration: none;
                    font-weight: 600;
                    display: inline-block;
                ">
                    View Pricing
                </a>
            </div>
        `;
        return false;
    }

    return true;
}


// Create a new account for the logged-in user(broker account)
async function createAccount(accountData, token) {

    const response = await fetch(
        `${API_URL}/accounts`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(accountData)
        }
    );

    return response.json();
}

// Get Accounts
async function getAccounts(token){
    const key    = "accounts";
    const cached = _cacheGet(key);
    if(cached) return cached;

    const response = await fetch(
        `${API_URL}/accounts`,
        { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    _cacheSet(key, data);
    return data;
}


// Delete an account for the logged-in user(broker account)
async function deleteAccount(accountId, token){

    const response = await fetch(
        `${API_URL}/accounts/${accountId}`,
        {
            method:"DELETE",
            headers:{
                "Authorization":
                `Bearer ${token}`
            }
        }
    );

    return response.json();
}


// Create a new trade for the logged-in user(broker account)
async function createTrade(tradeData, token){

    const response =
    await fetch(

        `${API_URL}/trades`,
        {
            method:"POST",
            headers:{
                "Content-Type":
                "application/json",

                "Authorization":
                `Bearer ${token}`
            },

            body:JSON.stringify(
                tradeData
            )
        }
    );

    return response.json();
}

// Get all trades for the logged-in user(broker account)
async function getTrades(token){
    const key    = `trades${activeAccountParam()}`;
    const cached = _cacheGet(key);
    if(cached) return cached;

    const response = await fetch(
        `${API_URL}/trades${activeAccountParam()}`,
        { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    _cacheSet(key, data);
    return data;
}

// Analytics fro logged-in account
async function getAnalytics(token){
    const key    = `analytics${activeAccountParam()}`;
    const cached = _cacheGet(key);
    if(cached) return cached;

    const response = await fetch(
        `${API_URL}/analytics${activeAccountParam()}`,
        { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    _cacheSet(key, data);
    return data;
}

// Delete a trade for the logged-in user(broker account)
async function deleteTrade(tradeId, token){
    const response = await fetch(
        `${API_URL}/trades/${tradeId}`,
        {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        }
    );
    _cacheInvalidate(); // trades changed — bust cache
    return response.json();
}

// Create a new journal entry
async function createJournal(token, journalData){

    const response =
    await fetch(
        `${API_URL}/journals`,
        {
            method:"POST",
            headers:{
                "Content-Type":
                "application/json",

                "Authorization":
                `Bearer ${token}`
            },

            body:JSON.stringify(
                journalData
            )
        }
    );

    return response.json();

}

// Get joutnal entries
async function getJournals(token){
    const key    = "journals";
    const cached = _cacheGet(key);
    if(cached) return cached;

    const response = await fetch(
        `${API_URL}/journals`,
        { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    _cacheSet(key, data);
    return data;
}

// mt5 account sync
async function syncMT5(token){

    const response =
    await fetch(

        `${API_URL}/mt5/sync`,

        {
            method:"POST",

            headers:{
                Authorization:
                `Bearer ${token}`
            }
        }

    );

    return response.json();

}

    // live mt5 account sync(dashboard view)
async function getMT5Account(token){

    const response =
    await fetch(

        `${API_URL}/mt5/account`,

        {
            headers:{
                Authorization:
                `Bearer ${token}`
            }
        }

    );

    return response.json();

}


// calendar heatmap data for the logged-in user(broker account)
async function getHeatmap(token){
    const key    = `heatmap${activeAccountParam()}`;
    const cached = _cacheGet(key);
    if(cached) return cached;

    const response = await fetch(
        `${API_URL}/analytics/heatmap${activeAccountParam()}`,
        { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    _cacheSet(key, data);
    return data;
}


// monthly Summary(above calendar)
async function getDayTrades(token,date){

    const response =
    await fetch(

        `${API_URL}/analytics/day/${date}`,

        {
            headers:{
                Authorization:
                `Bearer ${token}`
            }
        }

    );

    return await response.json();

}

// Monthly Review
async function getMonthlyPerformance(token){
    const key    = `monthly${activeAccountParam()}`;
    const cached = _cacheGet(key);
    if(cached) return cached;

    const response = await fetch(
        `${API_URL}/analytics/monthly${activeAccountParam()}`,
        { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    _cacheSet(key, data);
    return data;
}

// ── Toast notification system 
function _ensureToastContainer(){
    let container = document.getElementById("toast-container");
    if(!container){
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type = "info", duration = 3000){
    const container = _ensureToastContainer();

    const ICONS = {
        success: "fa-circle-check",
        error:   "fa-circle-exclamation",
        warning: "fa-triangle-exclamation",
        info:    "fa-circle-info"
    };

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${ICONS[type] || ICONS.info} toast-icon"></i>
        <span class="toast-msg">${message}</span>
        <button class="toast-close"><i class="fas fa-xmark"></i></button>
    `;

    container.appendChild(toast);

    // manual close
    toast.querySelector(".toast-close").addEventListener("click", () => dismiss(toast));

    // auto dismiss
    const timer = setTimeout(() => dismiss(toast), duration);

    function dismiss(el){
        clearTimeout(timer);
        el.style.animation = "toast-out 0.3s ease forwards";
        setTimeout(() => el.remove(), 300);
    }
}

// ── Reusable empty state ──────────────────────────────────────────────
function showEmptyState(container, { icon, title, message, actionLabel, actionHref }){
    container.innerHTML = `
        <div class="empty-state-card">
            <i class="fas ${icon}"></i>
            <h3>${title}</h3>
            <p>${message}</p>
            ${actionLabel && actionHref
                ? `<a href="${actionHref}" class="btn-primary" style="padding:10px 20px; border-radius:10px; text-decoration:none; font-size:13px; font-weight:600;">${actionLabel}</a>`
                : ""
            }
        </div>
    `;
}

// ── Reusable error state 
function showErrorState(container, message = "Something went wrong. Please refresh."){
    container.innerHTML = `
        <div class="error-state-card">
            <i class="fas fa-triangle-exclamation"></i>
            <h3>Could not load data</h3>
            <p>${message}</p>
            <button onclick="window.location.reload()" class="btn-primary" style="
                border:none; padding:10px 20px; border-radius:10px;
                cursor:pointer; font-size:13px; margin-top:8px;
            ">Try again</button>
        </div>
    `;
}

// ── Backend wake-up indicator 
// Render free tier spins down after inactivity. This pings the root
// endpoint and shows a non-blocking banner if it takes more than 2s.

async function pingBackend(){
    const TIMEOUT = 2000;
    const start   = Date.now();

    let banner = null;

    const timer = setTimeout(() => {
        banner = document.createElement("div");
        banner.id = "wake-banner";
        banner.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0;
            background: linear-gradient(90deg, #1e3a5f, #0d2137);
            border-bottom: 1px solid rgba(59,130,246,0.3);
            color: #93c5fd;
            font-size: 13px;
            font-weight: 500;
            padding: 10px 24px;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 99999;
            text-align: center;
            justify-content: center;
        `;
        banner.innerHTML = `
            <i class="fas fa-spinner fa-spin" style="font-size:12px;"></i>
            Backend is waking up — this takes about 30 seconds on first load…
        `;
        document.body.prepend(banner);
    }, TIMEOUT);

    try {
        await fetch(`${API_URL}/`);
    } catch(e) {
        // silent fail — banner will stay until next successful request
    } finally {
        clearTimeout(timer);
        if(banner){
            const elapsed = Date.now() - start;
            banner.innerHTML = `
                <i class="fas fa-circle-check" style="color:#4ade80; font-size:12px;"></i>
                Backend is ready!
            `;
            banner.style.background = "linear-gradient(90deg, #0d1f13, #091a0f)";
            banner.style.borderColor = "rgba(34,197,94,0.3)";
            banner.style.color       = "#86efac";
            setTimeout(() => banner?.remove(), 2000);
        }
    }
}

// run on every page load
pingBackend();


// Local sync agent
async function syncFromAgent(token){
    const response = await fetch("http://127.0.0.1:5001/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
    });
    _cacheInvalidate(); // new trades imported — bust cache
    return response.json();
}


    //sync agent status check
async function checkAgent() {
    try {
        const response = await fetch("http://127.0.0.1:5001/status");
        return response.ok;
    } catch(e) {
        return false;
    }
}

// ── PWA service worker registration ──────────────────────
if("serviceWorker" in navigator){
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/vAnalytics/sw.js")
            .then(reg => console.log("SW registered:", reg.scope))
            .catch(err => console.log("SW registration failed:", err));
    });
}
