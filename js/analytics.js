const token = localStorage.token;
if(!token) window.location.href = "../login.html";

let currentDate = new Date();

async function loadAnalytics() {

    const data = await getAnalytics(token);

    document.getElementById("totalProfit").textContent =
        `$${data.total_profit}`;

    document.getElementById("winRate").textContent =
        `${data.win_rate}%`;

    document.getElementById("bestTrade").textContent =
        `$${data.best_trade}`;

    document.getElementById("worstTrade").textContent =
        `$${data.worst_trade}`;

    // bottom row
    document.getElementById(
    "profitFactor"
    ).textContent =
        data.profit_factor;

    document.getElementById(
        "averageWin"
    ).textContent =
        `$${data.average_win}`;

    document.getElementById(
        "averageLoss"
    ).textContent =
        `$${data.average_loss}`;

    document.getElementById(
        "expectancy"
    ).textContent =
        `$${data.expectancy}`;

    // lower row
    document.getElementById(
    "averageTrade"
    ).textContent =
        `$${data.average_trade}`;

    document.getElementById(
        "maxDrawdown"
    ).textContent =
        `$${data.max_drawdown}`;

}


function profitClassFor(profit){
    if(profit > 100)  return "profit-strong-pos";
    if(profit > 0)    return "profit-pos";
    if(profit < -100) return "profit-strong-neg";
    if(profit < 0)    return "profit-neg";
    return "profit-flat";
}


function isSameDay(a, b){
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}


//  calendar heatmap data for the logged-in user(broker account)
async function loadHeatmap(){

    const data = await getHeatmap(token);
    const container = document.getElementById("heatmap");

    const year  = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();

    const monthData = data.filter(d => {
        const tradeDate = new Date(d.date);
        return (
            tradeDate.getFullYear() === year &&
            tradeDate.getMonth() === month
        );
    });

    const totalProfit = Number(
        monthData.reduce((sum, day) => sum + day.profit, 0)
    );

    const totalTrades = Number(
        monthData.reduce((sum, day) => sum + (day.trades || 0), 0)
    );

    const tradingDays = monthData.length;
    const winningDays = monthData.filter(d => d.profit > 0).length;
    const winRate = tradingDays > 0 ? (winningDays / tradingDays) * 100 : 0;

    const daysInMonth   = new Date(year, month + 1, 0).getDate();
    const firstWeekday  = new Date(year, month, 1).getDay(); // 0 = Sun

    // monthly summary
    document.getElementById("monthProfit").textContent =
        `Net Profit: $${totalProfit.toFixed(2)}`;
    document.getElementById("monthTrades").textContent =
        `Trades: ${totalTrades}`;
    document.getElementById("monthDays").textContent =
        `Trading Days: ${tradingDays}`;
    document.getElementById("monthWinRate").textContent =
        `Win Rate: ${winRate.toFixed(1)}%`;

    container.innerHTML = "";

    // Leading empty cells so day 1 lands on its real weekday
    for(let i = 0; i < firstWeekday; i++){
        const empty = document.createElement("div");
        empty.className = "calendar-day empty";
        container.appendChild(empty);
    }

    for(let day = 1; day <= daysInMonth; day++){

        const cell = document.createElement("div");
        const cellDate = new Date(year, month, day);

        const currentDateString =
            `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const tradeDay = data.find(d => d.date === currentDateString);

        cell.className = "calendar-day " + (tradeDay ? profitClassFor(tradeDay.profit) : "no-trades");
        if(isSameDay(cellDate, today)) cell.classList.add("is-today");

        cell.innerHTML = `<span>${day}</span>`;

        if(tradeDay){
            cell.title = `${tradeDay.date}\nProfit: ${tradeDay.profit}\nTrades: ${tradeDay.trades}`;
        } else {
            cell.title = `${currentDateString}\nNo trades`;
        }

        container.appendChild(cell);

        cell.addEventListener("click", async () => {

            const trades = await getDayTrades(token, currentDateString);

            document.getElementById("modalDate").textContent = currentDateString;

            const modalTrades = document.getElementById("modalTrades");

            if(trades.length === 0){
                modalTrades.innerHTML = `
                    <div class="day-modal-empty">
                        <i class="fas fa-calendar-xmark" style="font-size: 1.5rem; margin-bottom: 10px; display: block; opacity: 0.3;"></i>
                        No trades on this day.
                    </div>
                `;
            } else {
                modalTrades.innerHTML = trades.map(t => `
                    <div class="day-modal-trade">
                        <span style="font-weight: 600;">${t.symbol}</span>
                        <span style="color: ${t.profit >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">
                            ${t.profit >= 0 ? '+' : ''}$${t.profit}
                        </span>
                    </div>
                `).join("");
            }

            document.getElementById("dayModalOverlay").classList.add("open");
        });
    }

    // Set month title(e.g. "September 2024")
    document.getElementById("monthTitle").textContent =
        currentDate.toLocaleString("default", { month: "long", year: "numeric" });
}


document.getElementById("closeModal").addEventListener("click", () => {
    document.getElementById("dayModalOverlay").classList.remove("open");
});

document.getElementById("dayModalOverlay").addEventListener("click", (e) => {
    if(e.target.id === "dayModalOverlay"){
        document.getElementById("dayModalOverlay").classList.remove("open");
    }
});


// Month navigation
document.getElementById("prevMonth")
    .addEventListener("click", () => {
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        loadHeatmap();
    });

document.getElementById("nextMonth")
    .addEventListener("click", () => {
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        loadHeatmap();
    });


// monthly Review table
async function loadMonthlyTable(){

    const data = await getMonthlyPerformance(token);
    const tbody = document.querySelector("#monthlyTable tbody");

    tbody.innerHTML = "";

    data.forEach(month => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${month.month}</td>
            <td>${month.profit}</td>
            <td>${month.trades}</td>
            <td>${month.win_rate}%</td>
        `;
        tbody.appendChild(row);
    });
}


// Load Yearly Performance Chart
async function loadYearlyPerformance(){
    const monthly = await getMonthlyPerformance(token);
    const currentYear = new Date().getFullYear();
    const grid = document.getElementById("yearlyGrid");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const yearMonths = monthly.filter(m => m.month.startsWith(String(currentYear)));

    let cellsHtml = "";
    for(let i = 0; i < 12; i++){
        const monthKey = `${currentYear}-${String(i + 1).padStart(2, "0")}`;
        const data = yearMonths.find(m => m.month === monthKey);

        if(data){
            const color = data.profit >= 0 ? "var(--success)" : "var(--danger)";
            cellsHtml += `
                <div class="metric-card" style="text-align:center; padding:16px;">
                    <p style="font-size:13px; color:var(--muted); margin-bottom:6px;">${monthNames[i]}</p>
                    <span style="font-weight:700; color:${color};">${data.profit >= 0 ? "+" : ""}$${data.profit}</span>
                </div>
            `;
        } else {
            cellsHtml += `
                <div class="metric-card" style="text-align:center; padding:16px;">
                    <p style="font-size:13px; color:var(--muted); margin-bottom:6px;">${monthNames[i]}</p>
                    <span style="color:var(--muted);">—</span>
                </div>
            `;
        }
    }

    const ytdProfit = yearMonths.reduce((sum, m) => sum + m.profit, 0);
    const ytdTrades = yearMonths.reduce((sum, m) => sum + m.trades, 0);

    cellsHtml += `
        <div class="metric-card" style="text-align:center; padding:16px; background:rgba(59,130,246,.1); border-color:var(--primary);">
            <p style="font-size:13px; color:var(--muted); margin-bottom:6px;">YTD</p>
            <span style="font-size:1.3rem; font-weight:700; color:${ytdProfit >= 0 ? 'var(--success)' : 'var(--danger)'};">
                ${ytdProfit >= 0 ? "+" : ""}$${ytdProfit.toFixed(2)}
            </span>
            <p style="font-size:11px; color:var(--muted); margin-top:4px;">${ytdTrades} trades</p>
        </div>
    `;

    grid.innerHTML = cellsHtml;
}


// Render on Window Load
window.onload = function() {
    loadAnalytics();
    loadHeatmap();
    loadMonthlyTable();
    loadYearlyPerformance();
};
