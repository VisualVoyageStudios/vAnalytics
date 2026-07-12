const token = localStorage.token;
if(!token) window.location.href = "../login.html";

function getOutcomeLabel(entry){
    if(entry.planned_rr === null && entry.realized_rr === null){
        return { text: "No stop set", color: "var(--muted)" };
    }
    if(entry.profit > 0){
        return { text: "Win", color: "var(--success)" };
    }
    if(entry.profit < 0){
        return { text: "Loss", color: "var(--danger)" };
    }
    return { text: "Breakeven", color: "var(--muted)" };
}

function renderSummary(summary){
    document.getElementById("avgPlannedRR").textContent =
        summary.average_planned_rr > 0 ? `${summary.average_planned_rr}:1` : "—";

    document.getElementById("winRateRR").textContent =
        summary.trades_with_rr_set > 0 ? `${summary.win_rate_on_rr_trades}%` : "—";

    document.getElementById("trackedCount").textContent = summary.trades_with_rr_set;
    document.getElementById("totalCount").textContent   = summary.total_trades;
}

function renderTable(trades){
    const tbody = document.getElementById("riskRewardTable");

    if(!trades || trades.length === 0){
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; color:var(--muted); padding:60px 20px;">
                    <i class="fas fa-scale-balanced" style="font-size:2rem; margin-bottom:16px; display:block; opacity:0.3;"></i>
                    <p style="margin-bottom:8px;">No trades yet.</p>
                    <p style="font-size:13px;">Log trades with a stop loss and take profit to start tracking risk/reward.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = trades.map(entry => {
        const outcome = getOutcomeLabel(entry);
        const profitClass = entry.profit >= 0 ? "profit" : "loss";

        return `
            <tr>
                <td>${entry.symbol}</td>
                <td class="${profitClass}">$${entry.profit}</td>
                <td>${entry.planned_rr !== null ? entry.planned_rr + ":1" : "—"}</td>
                <td>${entry.realized_rr !== null ? entry.realized_rr + ":1" : "—"}</td>
                <td style="color:${outcome.color}; font-weight:600;">${outcome.text}</td>
            </tr>
        `;
    }).join("");
}

async function loadRiskReward(){
    try {
        const res  = await fetch(`${API_URL}/analytics/risk-reward`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        renderSummary(data.summary);
        renderTable(data.trades);

    } catch(err) {
        console.error(err);
        document.getElementById("riskRewardTable").innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; color:var(--muted); padding:60px 20px;">
                    <i class="fas fa-triangle-exclamation" style="font-size:2rem; margin-bottom:16px; display:block; opacity:0.3;"></i>
                    Could not load risk/reward data. Please refresh.
                </td>
            </tr>
        `;
    }
}

//Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "../login.html";
});

window.onload = loadRiskReward;
