document.addEventListener("DOMContentLoaded", () => {

    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const railToggle    = document.getElementById("railToggle");
    const railAvatar     = document.getElementById("railAvatar");
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
    railToggle?.addEventListener("click", openDrawer);
    railAvatar?.addEventListener("click", openDrawer);
    overlay?.addEventListener("click", closeDrawer);

    // populate drawer + rail avatar with logged-in user
    const token = localStorage.token;
    if(token){
        try{
            const payload = JSON.parse(atob(token.split(".")[1]));
            const email = payload.email || "";
            const emailEl = document.getElementById("drawerEmail");
            const avatarEl = document.getElementById("drawerAvatar");
            const railAvatarEl = document.getElementById("railAvatar");
            if(emailEl) emailEl.textContent = email;
            if(avatarEl && email) avatarEl.textContent = email[0].toUpperCase();
            if(railAvatarEl && email) railAvatarEl.textContent = email[0].toUpperCase();
        }catch(e){}
    }

    // fallback logout
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.removeItem("token");
        window.location.href = "../login.html";
    });
});
