document.addEventListener("DOMContentLoaded", () => {

    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const drawer = document.getElementById("navDrawer");
    const overlay = document.getElementById("drawerOverlay");

    function openDrawer(){
        drawer.classList.add("open");
        overlay.classList.add("show");
    }
    function closeDrawer(){
        drawer.classList.remove("open");
        overlay.classList.remove("show");
    }

    hamburgerBtn?.addEventListener("click", openDrawer);
    overlay?.addEventListener("click", closeDrawer);

    // populate drawer footer with logged-in user
    const token = localStorage.token;
    if(token){
        try{
            const payload = JSON.parse(atob(token.split(".")[1]));
            const email = payload.email || "";
            const emailEl = document.getElementById("drawerEmail");
            const avatarEl = document.getElementById("drawerAvatar");
            if(emailEl) emailEl.textContent = email;
            if(avatarEl && email) avatarEl.textContent = email[0].toUpperCase();
        }catch(e){}
    }

    // fallback logout — safe to have alongside page-specific listeners
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.removeItem("token");
        window.location.href = "../login.html";
    });
});