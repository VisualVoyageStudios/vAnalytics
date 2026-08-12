const token = localStorage.token;
if(!token) window.location.href = "../auth.html";

// ── Light mode toggle ────────────────────────────────────
const lightToggle = document.getElementById("appearance-lightmode");
if(lightToggle){
    lightToggle.checked = localStorage.getItem("voyager_theme") === "light";
    lightToggle.addEventListener("change", () => {
        if(lightToggle.checked){
            document.documentElement.classList.add("light");
            localStorage.setItem("voyager_theme", "light");
        } else {
            document.documentElement.classList.remove("light");
            localStorage.setItem("voyager_theme", "dark");
        }
    });
}

// ── Notification toggle persistence ──────────────────────
["notif-drawdown","notif-sync","notif-weekly","notif-news"].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.checked = localStorage.getItem(`voyager_${id}`) === "true";
    el.addEventListener("change", () => {
        localStorage.setItem(`voyager_${id}`, el.checked);
    });
});

// ── Profile ─────────────────────────────────────────────
function loadProfile() {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const email   = payload.email || "—";
        document.getElementById("profileEmail").textContent  = email;
        document.getElementById("avatarInitial").textContent = email[0].toUpperCase();
        const railAvatar = document.getElementById("railAvatar");
        if(railAvatar) railAvatar.textContent = email[0].toUpperCase();
    } catch(e) {
        console.error("Could not decode token", e);
    }
}

// ── Subscription status (real data from backend) ─────────
async function loadSubscription(){
    const body = document.getElementById("subscriptionBody");
    try {
        const res  = await fetch(`${API_URL}/auth/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        const tier = data.subscription_type || "free";

        if(tier === "lifetime"){
            body.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <span class="s-plan-badge lifetime"><i class="fas fa-crown"></i> Lifetime</span>
                    <span style="font-size:12px; color:var(--muted);">You have full, permanent access.</span>
                </div>
            `;
        } else if(tier === "monthly"){
            const paid      = data.total_paid || 0;
            const remaining = data.remaining_to_lifetime;
            const total     = remaining !== null && remaining !== undefined ? paid + remaining : null;
            const pct       = total ? Math.min(100, (paid / total) * 100) : 0;

            body.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                    <span class="s-plan-badge monthly"><i class="fas fa-rotate"></i> Monthly</span>
                    <a href="../pricing.html" style="font-size:12px; color:var(--primary); text-decoration:none;">Manage plan →</a>
                </div>
                <p style="font-size:12px; color:var(--muted); line-height:1.6;">
                    Every payment counts toward full lifetime ownership — once you've paid enough, you're automatically
                    upgraded to Lifetime and billing stops.
                </p>
                <div class="s-progress-track"><div class="s-progress-fill" style="width:${pct}%;"></div></div>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted);">
                    <span>Paid so far: R${paid.toFixed(2)}</span>
                    ${remaining !== null ? `<span>R${remaining.toFixed(2)} to go</span>` : ""}
                </div>
            `;
        } else {
            body.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <span class="s-plan-badge free"><i class="fas fa-seedling"></i> Free</span>
                    <a href="../pricing.html" class="s-btn s-btn-primary" style="padding:8px 16px; font-size:12px; text-decoration:none;">
                        View Plans
                    </a>
                </div>
            `;
        }
    } catch(err) {
        body.innerHTML = `<p style="color:var(--muted); font-size:13px;">Could not load subscription status.</p>`;
    }
}

// ── Change Password ──────────────────────────────────────
document.getElementById("changePasswordBtn").addEventListener("click", async () => {
    const newPassword     = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmNewPassword").value;
    const msg             = document.getElementById("passwordMsg");

    if (newPassword !== confirmPassword) {
        msg.style.color = "var(--danger)";
        msg.textContent = "Passwords do not match.";
        return;
    }
    if (newPassword.length < 6) {
        msg.style.color = "var(--danger)";
        msg.textContent = "Password must be at least 6 characters.";
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ new_password: newPassword })
        });
        const data = await res.json();

        if (res.ok) {
            msg.style.color = "var(--success)";
            msg.textContent = "Password updated.";
            document.getElementById("newPassword").value        = "";
            document.getElementById("confirmNewPassword").value = "";
        } else {
            msg.style.color = "var(--danger)";
            msg.textContent = data.detail || "Failed to update password.";
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }
});

// ── Sync platform tabs ───────────────────────────────────
document.querySelectorAll(".s-platform-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".s-platform-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".s-platform-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(`panel-${tab.dataset.platform}`).classList.add("active");
    });
});

// ── MT5 Sync Agent ───────────────────────────────────────
document.getElementById("downloadAgentBtn").addEventListener("click", () => {
    const batContent = `@echo off
echo ========================================
echo   Voyager Sync Agent Setup
echo ========================================
echo.
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/VisualVoyageStudios/vanalytics/refs/heads/main/backend/sync_agent.py' -OutFile '%TEMP%\\voyager_sync_agent.py'"
pip install fastapi uvicorn MetaTrader5 requests -q
py "%TEMP%\\voyager_sync_agent.py"
pause`;
    const blob = new Blob([batContent], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "Voyager_Sync_Agent.bat"; a.click();
    URL.revokeObjectURL(url);
});

async function checkAgentStatus() {
    const running = await checkAgent();
    const dot     = document.getElementById("agentDot");
    const status  = document.getElementById("agentStatus");
    if (running) {
        dot.classList.add("online");
        status.style.color = "var(--success)";
        status.textContent = "Sync Agent is running — ready to sync";
    } else {
        dot.classList.remove("online");
        status.style.color = "var(--muted)";
        status.textContent = "Sync Agent not running — complete Step 1 first";
    }
}

document.getElementById("syncNowBtn").addEventListener("click", async () => {
    const msg = document.getElementById("syncMsg");
    const btn = document.getElementById("syncNowBtn");
    const running = await checkAgent();

    if (!running) {
        msg.style.color = "var(--danger)";
        msg.textContent = "Sync Agent is not running. Complete Step 1 first.";
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing…';
    btn.disabled  = true;
    msg.textContent = "";

    try {
        const result = await syncFromAgent(token);
        if (result.status === "error") {
            msg.style.color = "var(--danger)";
            msg.textContent = result.message;
        } else {
            msg.style.color = "var(--success)";
            msg.textContent = result.imported > 0
                ? `${result.imported} new trades imported.`
                : "All up to date — no new trades found.";
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Could not reach Sync Agent. Make sure it is running.";
    }

    btn.innerHTML = '<i class="fas fa-rotate"></i> Sync Now';
    btn.disabled  = false;
});

checkAgentStatus();
setInterval(checkAgentStatus, 60000);

// ── MT4 report import ────────────────────────────────────
const mt4FileInput = document.getElementById("mt4FileInput");
const mt4UploadBtn = document.getElementById("mt4UploadBtn");

mt4FileInput.addEventListener("change", () => {
    const file = mt4FileInput.files[0];
    document.getElementById("mt4FileLabel").textContent = file ? file.name : "Click to choose your MT4 report file";
    mt4UploadBtn.disabled = !file;
});

mt4UploadBtn.addEventListener("click", async () => {
    const file = mt4FileInput.files[0];
    const msg  = document.getElementById("mt4Msg");
    if(!file) return;

    mt4UploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…';
    mt4UploadBtn.disabled  = true;

    try {
        const formData = new FormData();
        formData.append("file", file);

        const res  = await fetch(`${API_URL}/mt4/import`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();

        if(res.ok){
            msg.style.color = "var(--success)";
            msg.textContent = `${data.imported} trades imported from ${data.total_parsed} found.`;
            _cacheInvalidate();
        } else {
            msg.style.color = "var(--danger)";
            msg.textContent = data.detail || "Import failed.";
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }

    mt4UploadBtn.innerHTML = '<i class="fas fa-upload"></i> Import Report';
    mt4UploadBtn.disabled  = false;
});

// ── Deriv connect & sync ──────────────────────────────────
document.getElementById("derivConnectBtn").addEventListener("click", async () => {
    const apiToken = document.getElementById("derivTokenInput").value.trim();
    const msg      = document.getElementById("derivMsg");
    const btn      = document.getElementById("derivConnectBtn");

    if(!apiToken){
        msg.style.color = "var(--danger)";
        msg.textContent = "Paste your Deriv API token first.";
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting…';
    btn.disabled  = true;

    try {
        const connectRes = await fetch(`${API_URL}/deriv/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ api_token: apiToken })
        });
        const connectData = await connectRes.json();

        if(!connectRes.ok){
            msg.style.color = "var(--danger)";
            msg.textContent = connectData.detail || "Could not connect Deriv account.";
        } else {
            const syncRes  = await fetch(`${API_URL}/deriv/sync/${connectData.id}`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
            const syncData = await syncRes.json();

            msg.style.color = "var(--success)";
            msg.textContent = `Connected — ${syncData.imported || 0} trades imported.`;
            _cacheInvalidate();
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }

    btn.innerHTML = '<i class="fas fa-link"></i> Connect &amp; Sync';
    btn.disabled  = false;
});

// ── cTrader connect ────────────────────────────────────────
document.getElementById("ctraderConnectBtn").addEventListener("click", async () => {
    const msg = document.getElementById("ctraderMsg");
    try {
        const res  = await fetch(`${API_URL}/ctrader/connect`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        if(res.status === 503){
            msg.style.color = "var(--muted)";
            msg.textContent = "cTrader integration is being finalized — check back soon.";
            return;
        }
        if(data.authorization_url){
            window.location.href = data.authorization_url;
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }
});

// ── Clear Data ───────────────────────────────────────────
document.getElementById("clearDataBtn").addEventListener("click", async () => {
    if (!confirm("This will permanently delete ALL your trades and journal entries. Are you sure?")) return;
    const msg = document.getElementById("clearMsg");
    try {
        const res  = await fetch(`${API_URL}/data/clear`, {
            method: "DELETE", headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            msg.style.color = "var(--success)";
            msg.textContent = "All trade data cleared.";
            _cacheInvalidate();
        } else {
            msg.style.color = "var(--danger)";
            msg.textContent = data.detail || "Failed to clear data.";
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }
});

// ── Delete Account ───────────────────────────────────────
document.getElementById("deleteAccountBtn").addEventListener("click", async () => {
    if (!confirm("This will permanently delete your Voyager account and ALL data. This cannot be undone. Are you sure?")) return;
    const msg = document.getElementById("clearMsg");
    try {
        const res  = await fetch(`${API_URL}/auth/delete-account`, {
            method: "DELETE", headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.clear();
            window.location.href = "../auth.html";
        } else {
            msg.style.color = "var(--danger)";
            msg.textContent = data.detail || "Failed to delete account.";
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }
});

// ── Logout ───────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("voyager_active_account");
    window.location.href = "../auth.html";
});

// ── Accent colour picker ─────────────────────────────────
document.querySelectorAll(".s-accent-dot").forEach(dot => {
    dot.addEventListener("click", () => {
        document.querySelectorAll(".s-accent-dot").forEach(d => d.classList.remove("active"));
        dot.classList.add("active");
        const color = dot.dataset.color;
        document.documentElement.style.setProperty("--primary", color);
        localStorage.setItem("voyager_accent", color);
    });
});

const savedAccent = localStorage.getItem("voyager_accent");
if(savedAccent){
    document.documentElement.style.setProperty("--primary", savedAccent);
    document.querySelectorAll(".s-accent-dot").forEach(d => {
        d.classList.toggle("active", d.dataset.color === savedAccent);
    });
}

// ── Handle cTrader redirect back ─────────────────────────
if(new URLSearchParams(window.location.search).get("ctrader") === "connected"){
    showToast("cTrader account connected.", "success");
}

// ── Init ─────────────────────────────────────────────────
loadProfile();
loadSubscription();
