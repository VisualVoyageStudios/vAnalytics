const CACHE_NAME = "voyager-v38"
    ;
const STATIC_ASSETS = [
    "/vAnalytics/",
    "/vAnalytics/about.html",
    "/vAnalytics/terms.html",
    "/vAnalytics/privacy.html",
    "/vAnalytics/refund.html",
    "/vAnalytics/risk.html",
    "/vAnalytics/index.html",
    "/vAnalytics/auth.html",
    "/vAnalytics/pricing.html",
    "/vAnalytics/dashboard/dashboard.html",
    "/vAnalytics/dashboard/accounts.html",
    "/vAnalytics/dashboard/trades.html",
    "/vAnalytics/dashboard/analytics.html",
    "/vAnalytics/dashboard/journal.html",
    "/vAnalytics/dashboard/riskReward.html",
    "/vAnalytics/dashboard/watchlist.html",
    "/vAnalytics/dashboard/macroMatrix.html",
    "/vAnalytics/dashboard/centralBanks.html",
    "/vAnalytics/dashboard/tradeIdeas.html",
    "/vAnalytics/dashboard/currencyIntelligence.html",
    "/vAnalytics/dashboard/economicHeatmap.html",
    "/vAnalytics/dashboard/edgeFinder.html",
    "/vAnalytics/dashboard/cotPositioning.html",
    "/vAnalytics/dashboard/currencyStrength.html",
    "/vAnalytics/dashboard/correlationMatrix.html",
    "/vAnalytics/dashboard/aiInsights.html",
    "/vAnalytics/dashboard/sessionAnalysis.html",
    "/vAnalytics/dashboard/streaks.html",
    "/vAnalytics/dashboard/goalTracker.html",
    "/vAnalytics/dashboard/recapCard.html",
    "/vAnalytics/dashboard/reports.html",
    "/vAnalytics/dashboard/settings.html",
    "/vAnalytics/css/global.css",
    "/vAnalytics/css/landing.css",
    "/vAnalytics/css/ambient.css",
    "/vAnalytics/css/dashboard.css",
    "/vAnalytics/css/components.css",
    "/vAnalytics/css/pgAnime.css",
    "/vAnalytics/css/economicHeatmap.css",
    "/vAnalytics/css/tooltip.css",
    "/vAnalytics/js/api.js",
    "/vAnalytics/js/nav.js",
    "/vAnalytics/js/pgAnime.js",
    "/vAnalytics/js/dashboard.js",
    "/vAnalytics/js/analytics.js",
    "/vAnalytics/js/trades.js",
    "/vAnalytics/js/journal.js",
    "/vAnalytics/js/accounts.js",
    "/vAnalytics/js/settings.js",
    "/vAnalytics/js/riskReward.js",
    "/vAnalytics/js/recapCard.js",
    "/vAnalytics/js/currencyStrength.js",
    "/vAnalytics/js/edgeFinder.js",
    "/vAnalytics/js/economicHeatmap.js",
    "/vAnalytics/js/tooltip.js",
    "/vAnalytics/js/pwa-install.js",
    "/vAnalytics/icons/voyagerLogo-192.png",
    "/vAnalytics/icons/voyagerLogo-512.png"
];

// ── Install — cache static assets, resiliently ────────────────────────
// Uses allSettled instead of addAll so ONE bad/missing path doesn't
// silently kill caching for every other asset (that was the earlier
// "Uncaught TypeError: Failed to execute 'addAll'" bug).
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const results = await Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url))
            );
            const failed = results
                .map((r, i) => r.status === "rejected" ? STATIC_ASSETS[i] : null)
                .filter(Boolean);
            if (failed.length) {
                console.warn("SW install: could not cache these (site still works, they just won't be available offline):", failed);
            }
            return self.skipWaiting();
        })
    );
});

// ── Activate — clean up old caches ─────────────────────────────────────
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch strategy ──────────────────────────────────────────────────────
// Static assets: cache-first. API calls: network-first, falls back to cache.
self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);

    if(url.hostname === "vanalytics.onrender.com"){
        event.respondWith(
            fetch(event.request)
                .then(res => {
                    if(event.request.method === "GET" && res.ok){
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cached => cached || fetch(event.request)
                .then(res => {
                    if(res.ok){
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return res;
                })
            )
    );
});
