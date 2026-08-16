// ── PWA Install Handling ────────────────────────────────────────────────

let deferredInstallPrompt = null;

function isStandalone(){
    return window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
}

function isIos(){
    return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

// Chrome/Edge/Android — capture the native prompt instead of letting the
// browser show its own mini-infobar, so we control when/how it's offered
window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.querySelectorAll(".pwa-install-btn").forEach(btn => btn.style.display = "inline-flex");
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.querySelectorAll(".pwa-install-btn, .pwa-install-banner").forEach(el => el.style.display = "none");
    localStorage.setItem("voyager_pwa_installed", "true");
});

async function triggerPwaInstall(){
    if(deferredInstallPrompt){
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return;
    }
    if(isIos()){
        showIosInstallModal();
    }
}

function showIosInstallModal(){
    if(document.getElementById("iosInstallModal")) return;

    const modal = document.createElement("div");
    modal.id = "iosInstallModal";
    modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        display: flex; align-items: flex-end; justify-content: center;
        z-index: 99999;
    `;
    modal.innerHTML = `
        <div style="
            background: #101827; border: 1px solid #334155;
            border-radius: 20px 20px 0 0; padding: 28px 24px 36px;
            max-width: 420px; width: 100%; text-align: center;
        ">
            <div style="font-size: 2rem; margin-bottom: 14px;">📲</div>
            <h3 style="color: white; font-size: 1.1rem; margin-bottom: 10px;">Install Voyager</h3>
            <p style="color: #94a3b8; font-size: 0.88rem; line-height: 1.7; margin-bottom: 20px;">
                Tap <strong style="color:white;">Share</strong>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2" style="vertical-align:-3px; margin:0 2px;"><path d="M12 3v13m0-13l-4 4m4-4l4 4M5 21h14a2 2 0 002-2v-6a2 2 0 00-2-2h-3"/></svg>
                below, then choose <strong style="color:white;">Add to Home Screen</strong>.
            </p>
            <button id="closeIosModal" style="
                background: #3b82f6; color: white; border: none;
                padding: 12px 28px; border-radius: 10px; font-weight: 600;
                font-size: 0.9rem; cursor: pointer; width: 100%;
            ">Got it</button>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("closeIosModal").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => { if(e.target === modal) modal.remove(); });
}

// ── First-visit dashboard banner ────────────────────────────────────────
// Only on dashboard pages, only if not installed, not iOS-standalone,
// and not previously dismissed
function maybeShowInstallBanner(){
    if(isStandalone()) return;
    if(localStorage.getItem("voyager_pwa_installed") === "true") return;
    if(localStorage.getItem("voyager_pwa_banner_dismissed") === "true") return;
    if(!deferredInstallPrompt && !isIos()) return; // nothing to offer

    const banner = document.createElement("div");
    banner.className = "pwa-install-banner";
    banner.style.cssText = `
        position: fixed; bottom: 16px; left: 16px; right: 16px;
        max-width: 420px; margin: 0 auto;
        background: linear-gradient(135deg, #101827, #0d1420);
        border: 1px solid rgba(0,212,255,0.25);
        border-radius: 16px; padding: 16px 18px;
        display: flex; align-items: center; gap: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.4);
        z-index: 9998;
    `;
    banner.innerHTML = `
        <div style="
            width: 42px; height: 42px; border-radius: 12px;
            background: rgba(0,212,255,0.1); border: 1px solid rgba(0,212,255,0.25);
            display: flex; align-items: center; justify-content: center;
            color: #00d4ff; font-size: 18px; flex-shrink: 0;
        "><i class="fas fa-rocket"></i></div>
        <div style="flex: 1; min-width: 0;">
            <div style="color: white; font-weight: 700; font-size: 0.85rem;">Install Voyager</div>
            <div style="color: #94a3b8; font-size: 0.75rem;">Faster access, works offline</div>
        </div>
        <button class="pwa-install-btn" style="
            background: #3b82f6; color: white; border: none;
            padding: 8px 16px; border-radius: 8px; font-weight: 600;
            font-size: 0.78rem; cursor: pointer; white-space: nowrap;
        ">Install</button>
        <button id="dismissPwaBanner" style="
            background: none; border: none; color: #64748b;
            font-size: 16px; cursor: pointer; padding: 4px;
        "><i class="fas fa-xmark"></i></button>
    `;
    document.body.appendChild(banner);

    banner.querySelector(".pwa-install-btn").addEventListener("click", triggerPwaInstall);
    document.getElementById("dismissPwaBanner").addEventListener("click", () => {
        banner.remove();
        localStorage.setItem("voyager_pwa_banner_dismissed", "true");
    });
}

document.querySelectorAll(".pwa-install-btn").forEach(btn => {
    btn.addEventListener("click", triggerPwaInstall);
});

if(isStandalone()){
    localStorage.setItem("voyager_pwa_installed", "true");
}

// Show the banner shortly after load, only on dashboard pages
if(window.location.pathname.includes("/dashboard/")){
    window.addEventListener("load", () => setTimeout(maybeShowInstallBanner, 2500));
}
