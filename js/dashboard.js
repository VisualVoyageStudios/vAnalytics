const token = localStorage.token;
if(!token) window.location.href = "../login.html";
 
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

// ── Weekly Day Cards ─────────────────────────────────────────────────

let weekOffset = 0;

function getWeekDates(offset){
    const now = new Date();
    const day = now.getDay(); // 0 = Sun ... 6 = Sat
    const diffToMonday = (day === 0 ? -6 : 1) - day;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);

    const dates = [];
    for(let i = 0; i < 7; i++){
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

async function loadWeekCards(){
    const heatmap = await getHeatmap(token);
    const dates   = getWeekDates(weekOffset);
    const grid    = document.getElementById("weekDaysGrid");
    const label   = document.getElementById("weekLabel");

    label.textContent = weekOffset === 0
        ? "Current Week"
        : `${dates[0].toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - ${dates[6].toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;

    grid.innerHTML = dates.map(d => {
        const iso     = d.toISOString().slice(0, 10);
        const dayData = heatmap.find(h => h.date === iso);
        const profit  = dayData ? dayData.profit : 0;
        const trades  = dayData ? dayData.trades : 0;
        const color   = profit > 0 ? "var(--success)" : profit < 0 ? "var(--danger)" : "var(--muted)";
        const dayName = d.toLocaleDateString("en-GB", { weekday: "short" });
        const dayNum  = d.getDate().toString().padStart(2, "0");

        return `
            <div class="metric-card" style="text-align:left;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-weight:700; font-size:14px;">${dayName} ${dayNum}</span>
                    <span style="font-weight:700; color:${color}; font-size:13px;">
                        ${profit > 0 ? "+" : ""}$${profit}
                    </span>
                </div>
                <p style="color:var(--muted); font-size:12px;">${trades} trade${trades === 1 ? "" : "s"}</p>
            </div>
        `;
    }).join("");
}

async function loadAccountBalance(){
    const heatmap = await getHeatmap(token);
    const cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const last30 = heatmap.filter(h => new Date(h.date) >= cutoff);
    const total  = last30.reduce((sum, h) => sum + h.profit, 0);

    const el = document.getElementById("accountBalanceValue");
    el.textContent  = `${total >= 0 ? "+" : ""}$${total.toFixed(2)}`;
    el.style.color  = total >= 0 ? "var(--success)" : "var(--danger)";
}

document.getElementById("prevWeekBtn").addEventListener("click", () => {
    weekOffset -= 1;
    loadWeekCards();
});

document.getElementById("nextWeekBtn").addEventListener("click", () => {
    weekOffset += 1;
    loadWeekCards();
});




// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "../login.html";
});


window.onload = () => {
    loadDashboard();
    loadHighImpactNews();
    loadWeekCards();
    loadAccountBalance();
};

