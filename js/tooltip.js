document.addEventListener("DOMContentLoaded", () => {

    // Touch devices: tap to toggle instead of relying on hover
    document.querySelectorAll(".info-tip").forEach(tip => {
        tip.setAttribute("tabindex", "0");

        tip.addEventListener("click", (e) => {
            e.stopPropagation();
            const wasActive = tip.classList.contains("tip-active");
            document.querySelectorAll(".info-tip.tip-active").forEach(t => t.classList.remove("tip-active"));
            if (!wasActive) tip.classList.add("tip-active");
        });

        // Flip below if too close to top of viewport
        const rect = tip.getBoundingClientRect();
        if (rect.top < 80) {
            tip.classList.add("tip-below");
        }
    });

    document.addEventListener("click", () => {
        document.querySelectorAll(".info-tip.tip-active").forEach(t => t.classList.remove("tip-active"));
    });
});
