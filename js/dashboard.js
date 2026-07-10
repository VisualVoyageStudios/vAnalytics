

// Show user email in topbar
try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const name = (payload.email || "voyager").split("@")[0];
    document.getElementById("welcomeName").textContent = `Welcome back, ${name}`;
} catch(e) {}

document.getElementById("welcomeDate").textContent =
    new Date().toLocaleDateString("en-GB", {
        weekday: "short", day: "2-digit", month: "short", year: "numeric"
    });

async function loadDashboard(){

    const analytics = await getAnalytics(token);
    const accounts  = await getAccounts(token);
    const trades    = await getTrades(token);

    document.getElementById("dashboardProfit").textContent   = `$${analytics.total_profit}`;
    document.getElementById("dashboardWinRate").textContent  = `${analytics.win_rate}%`;
    document.getElementById("dashboardAccounts").textContent = accounts.length;
    document.getElementById("dashboardTrades").textContent   = analytics.trade_count;

    buildEquityCurve(trades);

    const table = document.getElementById("recentTradesTable");
    table.innerHTML = "";

    if(trades.length === 0){
        table.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; color: var(--muted); padding: 40px 20px;">
                    <i class="fas fa-chart-line" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.3;"></i>
                    <p>No trades yet — sync your MT5 account in Settings.</p>
                </td>
            </tr>
        `;
    } else {
        trades.slice(-5).reverse().forEach(trade => {

            const row = document.createElement("tr");

            const profitClass = trade.profit >= 0
                ? "profit-positive"
                : "profit-negative";

            row.innerHTML = `
                <td>${trade.symbol}</td>
                <td>${trade.order_type}</td>
                <td class="${profitClass}">
                    ${trade.profit >= 0 ? "+" : ""}$${trade.profit}
                </td>
            `;

            table.appendChild(row);
        });
    }
}


function buildEquityCurve(trades){

    let equity = 0;
    const labels = [];
    const data   = [];

    trades.forEach((trade, index) => {
        equity += trade.profit;
        labels.push(`Trade ${index + 1}`);
        data.push(equity);
    });

    const ctx = document.getElementById("equityChart");

    if(window.equityChart &&
        typeof window.equityChart.destroy === "function"){
        window.equityChart.destroy();
    }

    window.equityChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Equity",
                data,
                borderColor: "#00d4ff",
                backgroundColor: "rgba(0, 212, 255, 0.05)",
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: "#94a3b8", maxTicksLimit: 8 },
                    grid:  { color: "rgba(255,255,255,0.05)" }
                },
                y: {
                    ticks: { color: "#94a3b8" },
                    grid:  { color: "rgba(255,255,255,0.05)" }
                }
            }
        }
    });
}

// Load High Impact News
async function loadHighImpactNews(){
    const emptyState = document.getElementById("newsEmptyState");
    const container  = emptyState.parentElement;

    try {
        const res    = await fetch(`${API_URL}/economic/calendar`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const events = await res.json();

        const today     = new Date().toISOString().slice(0, 10);
        const todayHigh = events.filter(e => e.impact === "high" && e.date.slice(0, 10) === today);

        container.querySelectorAll(".news-item").forEach(el => el.remove());

        if(todayHigh.length === 0){
            emptyState.style.display = "block";
            return;
        }

        emptyState.style.display = "none";

        todayHigh.forEach(ev => {
            const item = document.createElement("div");
            item.className = "news-item";
            item.style.cssText = `
                display:flex; justify-content:space-between; align-items:center;
                padding:14px 0; border-bottom:1px solid var(--border);
            `;
            item.innerHTML = `
                <div>
                    <p style="font-weight:600; font-size:13px;">${ev.event}</p>
                    <p style="font-size:11px; color:var(--muted); margin-top:2px;">${ev.country}</p>
                </div>
                <span style="font-size:12px; color:var(--muted);">
                    ${new Date(ev.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
            `;
            container.insertBefore(item, emptyState);
        });

    } catch(err) {
        console.error("High impact news fetch failed:", err);
    }
}






// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "../login.html";
});


window.onload = () => {
    loadDashboard();
    loadHighImpactNews();
};