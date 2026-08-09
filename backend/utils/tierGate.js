(function () {
    const token = localStorage.token;
    if (!token) return; // page-level redirect already handles unauthenticated visitors

    const requiredTier = document.body.dataset.minTier; // "monthly" or "lifetime"
    if (!requiredTier) return; // page isn't gated

    const RANK = { free: 0, monthly: 1, lifetime: 2 };

    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(user => {
            const userRank = RANK[user.subscription_type || "free"];
            const needRank = RANK[requiredTier];

            if (userRank >= needRank) return; // access granted, do nothing

            const main = document.querySelector(".main-content");
            if (!main) return;

            main.style.filter = "blur(6px)";
            main.style.pointerEvents = "none";
            main.style.userSelect = "none";

            const overlay = document.createElement("div");
            overlay.style.cssText = `
                position: fixed; inset: 0; z-index: 2000;
                background: rgba(7,11,20,0.55);
                display: flex; align-items: center; justify-content: center;
            `;
            overlay.innerHTML = `
                <div style="
                    background: var(--card); border: 1px solid var(--border);
                    border-radius: 20px; padding: 40px; max-width: 380px; text-align: center;
                ">
                    <i class="fas fa-lock" style="font-size:2rem; color:#00d4ff; margin-bottom:16px; display:block;"></i>
                    <h3 style="margin-bottom:10px;">${requiredTier === "lifetime" ? "Lifetime" : "Monthly"} feature</h3>
                    <p style="color:var(--muted); font-size:13px; margin-bottom:24px;">
                        This page is part of the ${requiredTier === "lifetime" ? "Lifetime" : "Monthly"} plan.
                        Upgrade to unlock it — every payment counts toward lifetime access.
                    </p>
                    <a href="../auth.html#pricing" class="btn-primary" style="display:inline-block; padding:12px 28px; border-radius:10px; text-decoration:none;">
                        View Plans
                    </a>
                </div>
            `;
            document.body.appendChild(overlay);
        })
        .catch(() => {});
})();
