const token = localStorage.token;
if(!token) window.location.href = "../login.html";

// ── Profile ─────────────────────────────────────────────
function loadProfile() {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const email   = payload.email || "—";
        document.getElementById("profileEmail").textContent  = email;
        document.getElementById("avatarInitial").textContent = email[0].toUpperCase();
    } catch(e) {
        console.error("Could not decode token", e);
    }
}

// ── Change Password ──────────────────────────────────────
document.getElementById("changePasswordForm")
    .addEventListener("submit", async (e) => {
        e.preventDefault();

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
                headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${token}`
                },
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

// ── MT5 Sync Agent ───────────────────────────────────────
document.getElementById("downloadAgentBtn").addEventListener("click", () => {
    const batContent = `@echo off
echo ========================================
echo   Voyager Sync Agent Setup
echo ========================================
echo.
echo Downloading Sync Agent...
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/VisualVoyageStudios/vanalytics/refs/heads/main/backend/sync_agent.py' -OutFile '%TEMP%\\voyager_sync_agent.py'"
echo.
echo Installing requirements...
pip install fastapi uvicorn MetaTrader5 requests -q
echo.
echo ========================================
echo   Sync Agent is running!
echo   Keep this window open in the background
echo   then click Sync Now on the Voyager website.
echo ========================================
echo.
py "%TEMP%\\voyager_sync_agent.py"
pause`;

    const blob = new Blob([batContent], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "Voyager_Sync_Agent.bat";
    a.click();
    URL.revokeObjectURL(url);
});

async function checkAgentStatus() {
    const running = await checkAgent();
    const dot     = document.getElementById("agentDot");
    const status  = document.getElementById("agentStatus");

    if (running) {
        dot.style.background  = "var(--success)";
        status.style.color   = "var(--success)";
        status.textContent   = "Sync Agent is running — ready to sync";
    } else {
        dot.style.background  = "var(--danger)";
        status.style.color   = "var(--muted)";
        status.textContent   = "Sync Agent not running — complete Step 1 first";
    }
}

document.getElementById("syncNowBtn").addEventListener("click", async () => {
    const msg = document.getElementById("syncMsg");
    const btn = document.getElementById("syncNowBtn");
    const running = await checkAgent();

    if (!running) {
        msg.style.color = "var(--danger)";
        msg.textContent = "Sync Agent is not running. Please complete Step 1 first.";
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
        msg.textContent = "Could not reach Sync Agent. Make sure it is still running.";
    }

    btn.innerHTML = '<i class="fas fa-rotate"></i> Sync Now';
    btn.disabled  = false;
});

checkAgentStatus();
setInterval(checkAgentStatus, 60000);

// ── Clear Data ───────────────────────────────────────────
document.getElementById("clearDataBtn").addEventListener("click", async () => {
    const confirmed = confirm(
        "This will permanently delete ALL your trades and journal entries. Are you sure?"
    );
    if (!confirmed) return;

    const msg = document.getElementById("clearMsg");

    try {
        const res  = await fetch(`${API_URL}/data/clear`, {
            method:  "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.ok) {
            msg.style.color = "var(--success)";
            msg.textContent = "All trade data cleared.";
        } else {
            msg.style.color = "var(--danger)";
            msg.textContent = data.detail || "Failed to clear data.";
        }
    } catch {
        msg.style.color = "var(--danger)";
        msg.textContent = "Something went wrong. Try again.";
    }
});

// ── Init ─────────────────────────────────────────────────
loadProfile();
