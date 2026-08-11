document.addEventListener("DOMContentLoaded", () => {

    const drawer  = document.getElementById("navDrawer");
    const overlay = document.getElementById("drawerOverlay");

    if (!drawer || !overlay) {
        console.warn("nav.js: drawer or overlay element missing on this page");
        return;
    }

    function openDrawer(){
        drawer.classList.add("open");
        overlay.classList.add("show");
    }
    function closeDrawer(){
        drawer.classList.remove("open");
        overlay.classList.remove("show");
    }

    // Event delegation — works regardless of duplicate IDs, load order,
    // or which specific trigger element exists on a given page.
    document.addEventListener("click", (e) => {
        if (e.target.closest("#hamburgerBtn, #railToggle, #railAvatar, .nav-open-trigger")) {
            openDrawer();
            return;
        }
        if (e.target === overlay || e.target.closest("#closeDrawerBtn")) {
            closeDrawer();
            return;
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && drawer.classList.contains("open")) {
            closeDrawer();
        }
    });

    // populate drawer footer with logged-in user
    const token = localStorage.token;
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            const email = payload.email || "";
            const emailEl      = document.getElementById("drawerEmail");
            const avatarEl     = document.getElementById("drawerAvatar");
            const railAvatarEl = document.getElementById("railAvatar");
            if (emailEl)  emailEl.textContent = email;
            if (avatarEl && email)     avatarEl.textContent = email[0].toUpperCase();
            if (railAvatarEl && email) railAvatarEl.textContent = email[0].toUpperCase();
        } catch (e) {}
    }

    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.removeItem("token");
        window.location.href = "../login.html";
    });
});
