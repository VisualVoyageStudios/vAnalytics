const CACHE_NAME = "voyager-v12";
const STATIC_ASSETS = [
    "/vAnalytics/",
    "/vAnalytics/dashboard/dashboard.html",
    "/vAnalytics/dashboard/trades.html",
    "/vAnalytics/dashboard/analytics.html",
    "/vAnalytics/dashboard/journal.html",
    "/vAnalytics/dashboard/accounts.html",
    "/vAnalytics/dashboard/settings.html",
    "/vAnalytics/dashboard/riskReward.html",
    "/vAnalytics/dashboard/recapCard.html",
    "/vAnalytics/dashboard/streaks.html",
    "/vAnalytics/dashboard/goalTracker.html",
    "/vAnalytics/dashboard/sessionAnalysis.html",
    "/vAnalytics/dashboard/aiInsights.html",
    "/vAnalytics/dashboard/reports.html",
    "/vAnalytics/dashboard/currencyStrength.html",
    "/vAnalytics/dashboard/correlationMatrix.html",
    "/vAnalytics/dashboard/economicHeatmap.html",
    "/vAnalytics/dashboard/edgeFinder.html",
    "/vAnalytics/dashboard/macroMatrix.html",
    "/vAnalytics/dashboard/centralBanks.html",
    "/vAnalytics/dashboard/tradeIdeas.html",
    "/vAnalytics/dashboard/currencyIntelligence.html",
    "/vAnalytics/dashboard/cotPositioning.html",
    "/vAnalytics/dashboard/watchlist.html",
    "/vAnalytics/css/global.css",
    "/vAnalytics/css/dashboard.css",
    "/vAnalytics/css/components.css",
    "/vAnalytics/css/pgAnime.css",
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
    "/vAnalytics/icons/voyagerLogo-192.png",
    "/vAnalytics/icons/voyagerLogo-512.png"
];

// ── Install — cache static assets ─────────────────────────────────────
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ── Activate — clean up old caches ───────────────────────────────────
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch strategy ────────────────────────────────────────────────────
// Static assets: cache-first (fast loads, works offline)
// API calls: network-first (always try live data, fall back to cache)
self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);

    // API requests — network first
    if(url.hostname === "vanalytics.onrender.com"){
        event.respondWith(
            fetch(event.request)
                .then(res => {
                    // cache successful GET responses
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

    // Static assets — cache first
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
