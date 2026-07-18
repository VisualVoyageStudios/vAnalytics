document.addEventListener("DOMContentLoaded", () => {

    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const drawer       = document.getElementById("navDrawer");
    const overlay      = document.getElementById("drawerOverlay");
    const rail         = document.querySelector(".nav-rail");

    function openDrawer(){
        drawer?.classList.add("open");
        overlay?.classList.add("show");
    }
    function closeDrawer(){
        drawer?.classList.remove("open");
        overlay?.classList.remove("show");
    }

    hamburgerBtn?.addEventListener("click", () => {
        // on mobile — toggle rail
        if(window.innerWidth <= 768 && rail){
            rail.classList.toggle("open");
            return;
        }
        // on desktop — open full drawer
        openDrawer();
    });

    overlay?.addEventListener("click", closeDrawer);

    // rail toggle button (settings page)
    document.getElementById("railToggle")?.addEventListener("click", openDrawer);

    // populate drawer/rail footer with logged-in user
    const token = localStorage.token;
    if(token){
        try{
            const payload = JSON.parse(atob(token.split(".")[1]));
            const email   = payload.email || "";
            const emailEl  = document.getElementById("drawerEmail");
            const avatarEl = document.getElementById("drawerAvatar");
            const railAv   = document.getElementById("railAvatar");
            if(emailEl)  emailEl.textContent  = email;
            if(avatarEl && email) avatarEl.textContent = email[0].toUpperCase();
            if(railAv   && email) railAv.textContent   = email[0].toUpperCase();
        }catch(e){}
    }

    // account switcher
    async function loadAccountSwitcher(){
        if(!token) return;
        try {
            const accounts = await getAccounts(token);
            if(!accounts || accounts.length <= 1) return;

            const topnav   = document.querySelector(".topnav");
            const titleEl  = document.querySelector(".topnav-title");
            if(!topnav || !titleEl) return;

            const activeId = getActiveAccountId();
            const switcher = document.createElement("div");
            switcher.style.cssText = "display:flex; align-items:center; gap:8px; margin-left:12px;";

            const select = document.createElement("select");
            select.style.cssText = `
                background: var(--card);
                border: 1px solid var(--border);
                color: white;
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 12px;
                cursor: pointer;
                outline: none;
            `;

            const allOption = document.createElement("option");
            allOption.value       = "";
            allOption.textContent = "All Accounts";
            if(!activeId) allOption.selected = true;
            select.appendChild(allOption);

            accounts.forEach(account => {
                const opt = document.createElement("option");
                opt.value       = account.id;
                opt.textContent = account.account_number || account.broker;
                if(account.id === activeId) opt.selected = true;
                select.appendChild(opt);
            });

            select.addEventListener("change", () => {
                setActiveAccountId(select.value || null);
                _cacheInvalidate();
                window.location.reload();
            });

            switcher.appendChild(select);
            titleEl.after(switcher);

        } catch(err) {
            console.error("Account switcher failed:", err);
        }
    }

    loadAccountSwitcher();

    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("voyager_active_account");
        window.location.href = "../login.html";
    });
});
