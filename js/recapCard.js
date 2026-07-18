const token = localStorage.token;
if(!token) window.location.href = "../login.html";

const CARD_W = 800;
const CARD_H = 450;

function getWeekRange(){
    const now    = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    monday.setHours(0,0,0,0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const fmt = d => d.toLocaleDateString("en-GB", { day:"2-digit", month:"short" });
    return `${fmt(monday)} – ${fmt(sunday)}`;
}

function getWeekDates(){
    const now    = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    monday.setHours(0,0,0,0);
    return monday;
}

async function generateCard(){
    const btn = document.getElementById("generateBtn");
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Generating…';
    btn.disabled  = true;

    try {
        const [heatmap, streakRes, sessionRes, analytics] = await Promise.all([
            getHeatmap(token),
            fetch(`${API_URL}/analytics/streaks`,  { headers: { "Authorization": `Bearer ${token}` } }).then(r => r.json()),
            fetch(`${API_URL}/analytics/sessions`, { headers: { "Authorization": `Bearer ${token}` } }).then(r => r.json()),
            getAnalytics(token)
        ]);

        const monday    = getWeekDates();
        const weekRange = getWeekRange();

        // filter to this week
        const weekData = heatmap.filter(d => {
            const date = new Date(d.date);
            const endOfWeek = new Date(monday);
            endOfWeek.setDate(monday.getDate() + 6);
            return date >= monday && date <= endOfWeek;
        });

        const weekProfit = weekData.reduce((s, d) => s + d.profit, 0);
        const weekTrades = weekData.reduce((s, d) => s + d.trades, 0);
        const winDays    = weekData.filter(d => d.profit > 0).length;
        const winRate    = weekTrades > 0 ? Math.round((winDays / weekData.length) * 100) : 0;

        const bestSession = sessionRes.length > 0
            ? sessionRes.reduce((a, b) => a.profit > b.profit ? a : b)
            : null;

        const streak = streakRes.current_streak || 0;
        const streakType = streakRes.current_streak_type || "none";

        // Get email initial for avatar
        let userInitial = "V";
        try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            userInitial = (payload.email || "V")[0].toUpperCase();
        } catch(e){}

        renderCanvas({
            weekRange, weekProfit, weekTrades,
            winRate, bestSession, streak, streakType,
            userInitial, analytics
        });

    } catch(err) {
        console.error(err);
        alert("Could not generate recap card. Try again.");
    }

    btn.innerHTML = '<i class="fas fa-rotate" style="margin-right:6px;"></i>Generate';
    btn.disabled  = false;
}


function renderCanvas(data){
    const canvas    = document.getElementById("recapCanvas");
    const ctx       = canvas.getContext("2d");
    const container = document.getElementById("previewArea");

    // scale canvas to container width on small screens
    const maxW    = Math.min(CARD_W, container.clientWidth - 32);
    const scale   = maxW / CARD_W;

    canvas.width  = CARD_W;
    canvas.height = CARD_H;
    canvas.style.width  = `${maxW}px`;
    canvas.style.height = `${Math.round(CARD_H * scale)}px`;

    // ── Background ──
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // ── Gradient overlay ──
    const grad = ctx.createRadialGradient(150, 100, 0, 150, 100, 400);
    grad.addColorStop(0, "rgba(0,212,255,0.06)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    const grad2 = ctx.createRadialGradient(CARD_W - 100, CARD_H, 0, CARD_W - 100, CARD_H, 350);
    grad2.addColorStop(0, "rgba(123,97,255,0.06)");
    grad2.addColorStop(1, "transparent");
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // ── Top accent bar ──
    const accentGrad = ctx.createLinearGradient(0, 0, CARD_W, 0);
    accentGrad.addColorStop(0, "#00d4ff");
    accentGrad.addColorStop(1, "#7b61ff");
    ctx.fillStyle = accentGrad;
    ctx.fillRect(0, 0, CARD_W, 3);

    // ── Border ──
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, CARD_W - 1, CARD_H - 1);

    // ── Logo / brand ──
    ctx.fillStyle   = "#00d4ff";
    ctx.font        = "bold 13px Inter, sans-serif";
    ctx.fillText("VOYAGER ANALYTICS", 32, 42);

    // ── Week range ──
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font      = "12px Inter, sans-serif";
    ctx.fillText(`Weekly Recap  •  ${data.weekRange}`, 32, 62);

    // ── Avatar circle ──
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.arc(CARD_W - 52, 42, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.font      = "bold 18px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(data.userInitial, CARD_W - 52, 49);
    ctx.textAlign = "left";

    // ── Divider ──
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(32, 82);
    ctx.lineTo(CARD_W - 32, 82);
    ctx.stroke();

    // ── Main profit figure ──
    const profitColor = data.weekProfit >= 0 ? "#22c55e" : "#ef4444";
    const profitSign  = data.weekProfit >= 0 ? "+" : "";

    ctx.fillStyle = profitColor;
    ctx.font      = "bold 64px Inter, sans-serif";
    ctx.fillText(`${profitSign}$${data.weekProfit.toFixed(2)}`, 32, 168);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font      = "13px Inter, sans-serif";
    ctx.fillText("WEEKLY P&L", 32, 192);

    // ── Stat boxes ──
    const stats = [
        { label: "TRADES",     value: String(data.weekTrades) },
        { label: "WIN RATE",   value: `${data.winRate}%` },
        { label: "STREAK",     value: `${data.streak} ${data.streakType === "win" ? "🔥" : data.streakType === "loss" ? "❄️" : "—"}` },
        { label: "BEST SESSION", value: data.bestSession ? data.bestSession.session : "—" },
    ];

    const boxW   = 160;
    const boxH   = 80;
    const startX = 32;
    const startY = 220;
    const gap    = 16;

    stats.forEach((stat, i) => {
        const x = startX + i * (boxW + gap);
        const y = startY;

        // box bg
        ctx.fillStyle   = "rgba(255,255,255,0.04)";
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth   = 1;
        roundRect(ctx, x, y, boxW, boxH, 10);
        ctx.fill();
        ctx.stroke();

        // value
        ctx.fillStyle = "white";
        ctx.font      = "bold 24px Inter, sans-serif";
        ctx.fillText(stat.value, x + 14, y + 36);

        // label
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font      = "10px Inter, sans-serif";
        ctx.fillText(stat.label, x + 14, y + 56);
    });

    // ── Overall win rate bar ──
    const barY = 330;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font      = "11px Inter, sans-serif";
    ctx.fillText(`ALL-TIME WIN RATE  ${data.analytics.win_rate}%`, 32, barY);

    ctx.fillStyle   = "rgba(255,255,255,0.06)";
    ctx.strokeStyle = "transparent";
    roundRect(ctx, 32, barY + 10, CARD_W - 64, 8, 4);
    ctx.fill();

    const fillW = ((data.analytics.win_rate || 0) / 100) * (CARD_W - 64);
    const barGrad = ctx.createLinearGradient(32, 0, 32 + fillW, 0);
    barGrad.addColorStop(0, "#00d4ff");
    barGrad.addColorStop(1, "#7b61ff");
    ctx.fillStyle = barGrad;
    roundRect(ctx, 32, barY + 10, fillW, 8, 4);
    ctx.fill();

    // ── Footer ──
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.font      = "11px Inter, sans-serif";
    ctx.fillText("voyageranalytics.netlify.app", 32, CARD_H - 22);

    ctx.textAlign = "right";
    ctx.fillText(`Total Trades: ${data.analytics.trade_count}  •  Total P&L: $${data.analytics.total_profit}`, CARD_W - 32, CARD_H - 22);
    ctx.textAlign = "left";

    // ── Show canvas ──
    document.getElementById("placeholder").style.display = "none";
    canvas.style.display = "block";
    document.getElementById("downloadBtn").style.display = "inline-block";
}


function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}


document.getElementById("generateBtn").addEventListener("click", generateCard);

document.getElementById("downloadBtn").addEventListener("click", () => {
    const canvas = document.getElementById("recapCanvas");
    const link   = document.createElement("a");
    link.download = `voyager-recap-${new Date().toISOString().slice(0,10)}.png`;
    link.href     = canvas.toDataURL("image/png");
    link.click();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "../login.html";
});
