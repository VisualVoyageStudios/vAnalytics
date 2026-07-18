const token = localStorage.token;
if(!token) window.location.href = "../login.html";
 
let allTrades = [];

function formatDate(dateString){
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

// render trades
const PAGE_SIZE = 50;
let currentPage = 1;

function renderTrades(trades){
    const table      = document.getElementById("tradesTable");
    const totalPages = Math.ceil(trades.length / PAGE_SIZE);
    const start      = (currentPage - 1) * PAGE_SIZE;
    const paginated  = trades.slice(start, start + PAGE_SIZE);

    table.innerHTML = "";

    if(trades.length === 0){
        table.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state-card">
                        <i class="fas fa-chart-line"></i>
                        <h3>No trades found</h3>
                        <p>Try adjusting your filters, or sync your MT5 account from Settings.</p>
                    </div>
                </td>
            </tr>
        `;
        renderPagination(0, 0);
        return;
    }

    paginated.forEach(trade => {
        const row = document.createElement("tr");
        const profitClass = trade.profit >= 0 ? "profit" : "loss";

        row.innerHTML = `
            <td>${trade.symbol}</td>
            <td>${trade.order_type}</td>
            <td>${trade.lot_size}</td>
            <td class="${profitClass}">$${trade.profit}</td>
            <td>${formatDate(trade.created_at)}</td>
            <td>
                <button class="delete-btn" data-id="${trade.id}">Delete</button>
            </td>
        `;

        row.querySelector(".delete-btn").addEventListener("click", async () => {
            if(!confirm("Delete this trade?")) return;
            await deleteTrade(trade.id, token);
            allTrades = allTrades.filter(t => t.id !== trade.id);
            applyFilters();
            showToast("Trade deleted.", "success");
        });

        table.appendChild(row);
    });

    renderPagination(currentPage, totalPages);
}

// page number
function renderPagination(page, totalPages){
    // remove old pagination if present
    const existing = document.getElementById("tradesPagination");
    if(existing) existing.remove();

    if(totalPages <= 1) return;

    const pag = document.createElement("div");
    pag.id = "tradesPagination";
    pag.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 20px 0;
    `;

    const btnStyle = `
        background: var(--card);
        border: 1px solid var(--border);
        color: white;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        transition: border-color 0.2s;
    `;

    const activeBtnStyle = `
        background: rgba(59,130,246,0.15);
        border: 1px solid var(--primary);
        color: white;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
    `;

    // prev
    const prev = document.createElement("button");
    prev.innerHTML = "← Prev";
    prev.style.cssText = btnStyle;
    prev.disabled = page <= 1;
    prev.addEventListener("click", () => {
        currentPage--;
        applyFilters();
    });
    pag.appendChild(prev);

    // page numbers
    for(let i = 1; i <= totalPages; i++){
        if(totalPages > 7 && Math.abs(i - page) > 2 && i !== 1 && i !== totalPages){
            if(i === 2 || i === totalPages - 1){
                const ellipsis = document.createElement("span");
                ellipsis.textContent = "…";
                ellipsis.style.color = "var(--muted)";
                pag.appendChild(ellipsis);
            }
            continue;
        }
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.style.cssText = i === page ? activeBtnStyle : btnStyle;
        btn.addEventListener("click", () => {
            currentPage = i;
            applyFilters();
        });
        pag.appendChild(btn);
    }

    // next
    const next = document.createElement("button");
    next.innerHTML = "Next →";
    next.style.cssText = btnStyle;
    next.disabled = page >= totalPages;
    next.addEventListener("click", () => {
        currentPage++;
        applyFilters();
    });
    pag.appendChild(next);

    // info
    const info = document.createElement("span");
    const start = (page - 1) * PAGE_SIZE + 1;
    const end   = Math.min(page * PAGE_SIZE, allTrades.length);
    info.textContent = `${start}–${end} of ${allTrades.length}`;
    info.style.cssText = "font-size:12px; color:var(--muted); margin-left:8px;";
    pag.appendChild(info);

    // insert after the table section
    const tableSection = document.querySelector(".section-card");
    if(tableSection) tableSection.after(pag);
}


function applyFilters(){
    const search    = document.getElementById("searchTrade").value.toLowerCase();
    const direction = document.getElementById("directionFilter").value;
    const result    = document.getElementById("resultFilter").value;

    const filtered = allTrades.filter(trade => {
        const matchSymbol    = trade.symbol.toLowerCase().includes(search);
        const matchDirection = direction === "" || trade.order_type === direction;
        const matchResult    = result === ""
            || (result === "profit" && trade.profit >= 0)
            || (result === "loss"   && trade.profit < 0);
        return matchSymbol && matchDirection && matchResult;
    });

    // reset to page 1 when filters change
    currentPage = 1;
    renderTrades(filtered);
}



function applyFilters(){
    const search    = document.getElementById("searchTrade").value.toLowerCase();
    const direction = document.getElementById("directionFilter").value;
    const result    = document.getElementById("resultFilter").value;

    const filtered = allTrades.filter(trade => {

        const matchSymbol    = trade.symbol.toLowerCase().includes(search);
        const matchDirection = direction === "" || trade.order_type === direction;
        const matchResult    = result === ""
            || (result === "profit" && trade.profit >= 0)
            || (result === "loss"   && trade.profit < 0);

        return matchSymbol && matchDirection && matchResult;
    });

    renderTrades(filtered);
}

async function loadTrades(){
    allTrades = await getTrades(token);
    renderTrades(allTrades);
}

// Filter listeners
document.getElementById("searchTrade")
    .addEventListener("input", applyFilters);

document.getElementById("directionFilter")
    .addEventListener("change", applyFilters);

document.getElementById("resultFilter")
    .addEventListener("change", applyFilters);

// Export to CSV
document.getElementById("exportBtn")
    .addEventListener("click", async () => {

        if(!allTrades || allTrades.length === 0){
            alert("No trades to export.");
            return;
        }

        const headers = ["Symbol","Type","Lot Size","Open Price","Close Price","Profit","Date"];

        const rows = allTrades.map(trade => [
            trade.symbol,
            trade.order_type,
            trade.lot_size,
            trade.open_price,
            trade.close_price,
            trade.profit,
            formatDate(trade.created_at)
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(row => row.join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");

        a.href     = url;
        a.download = `voyager-trades-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();

        URL.revokeObjectURL(url);
    });

loadTrades();

//Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "../login.html";
});
