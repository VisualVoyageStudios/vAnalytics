const token = localStorage.token;
if(!token) window.location.href = "../login.html";

const FLAGS ={
    USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
    AUD: "🇦🇺", CAD: "🇨🇦", NZD: "🇳🇿", CHF: "🇨🇭",
    ZAR: "🇿🇦"
};

const PAIRS =[
    "EURUSD","GBPUSD","USDJPY","USDCHF",
    "AUDUSD","USDCAD","NZDUSD","GBPJPY",
    "EURJPY","EURGBP","AUDJPY","CADJPY",
    "USDZAR","EURZAR","GBPZAR"
];

let strengthData = [];

// ── Normalise score to 0–100 relative to the current data range ──────
// This ensures bars are always visible regardless of how small the
// raw percentage changes are (e.g. 0.05% vs 0.23%)
function normaliseScores(data){
    const scores = data.map(c => c.score);
    const max    = Math.max(...scores.map(Math.abs));
    if(max === 0) return data.map(c => ({ ...c, _norm: 0 }));
    return data.map(c => ({ ...c, _norm: (c.score / max) * 100 }));
}

// ── Colour based on normalised score ─────────────────────────────────
function scoreColor(norm){
    if(norm >= 20)  return "#22c55e";   // clearly positive = green
    if(norm <= -20) return "#ef4444";   // clearly negative = red
    return "#94a3b8";                   // near-neutral = grey
}

function scoreBias(norm){
    if(norm >= 20)  return "Bullish";
    if(norm <= -20) return "Bearish";
    return "Neutral";
}

function scoreLabel(norm){
    if(norm >= 20)  return "Strong";
    if(norm <= -20) return "Weak";
    return "Neutral";
}


async function loadStrength(){
    const grid  = document.getElementById("strengthGrid");
    const tbody = document.getElementById("strengthTable");

    grid.innerHTML = `
        <div style="color:var(--muted); font-size:13px; padding:40px; text-align:center; grid-column:1/-1;">
            <i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>
            Loading currency data…
        </div>
    `;

    try {
        const res = await fetch(`${API_URL}/currency/strength`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const raw = await res.json();

        if(!Array.isArray(raw)) throw new Error("Invalid response");

        // sort by raw score descending, then normalise
        raw.sort((a, b) => b.score - a.score);
        strengthData = normaliseScores(raw);

        renderGauges();
        renderTable();
        renderPairMatrix();

        document.getElementById("lastUpdated").textContent =
            `Updated ${new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;

    } catch(err) {
        console.error(err);
        grid.innerHTML = `
            <div style="color:var(--muted); text-align:center; padding:40px; grid-column:1/-1;">
                <i class="fas fa-triangle-exclamation" style="font-size:2rem; opacity:0.3; display:block; margin-bottom:12px;"></i>
                Could not load currency data. Please refresh.
            </div>
        `;
    }
}


function renderGauges(){
    const grid = document.getElementById("strengthGrid");

    grid.innerHTML = strengthData.map(c => {
        const color    = scoreColor(c._norm);
        const label    = scoreLabel(c._norm);
        const barWidth = Math.abs(c._norm) / 2; // max 50% each side of centre
        const sign     = c.score > 0 ? "+" : "";
        // show raw score with 4 decimal places so tiny moves are visible
        const display  = `${sign}${c.score.toFixed(4)}%`;

        return `
            <div style="
                background: var(--card);
                border: 1px solid var(--border);
                border-radius: 14px;
                padding: 20px;
                transition: border-color 0.2s;
            ">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:24px;">${FLAGS[c.code] || "🌐"}</span>
                        <div>
                            <div style="font-weight:700; font-size:16px;">${c.code}</div>
                            <div style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">${label}</div>
                        </div>
                    </div>
                    <div style="font-size:1.2rem; font-weight:800; color:${color}; font-variant-numeric: tabular-nums;">
                        ${display}
                    </div>
                </div>

                <!-- Centre-origin bar -->
                <div style="
                    background: rgba(255,255,255,0.05);
                    border-radius: 4px;
                    height: 6px;
                    overflow: hidden;
                    position: relative;
                ">
                    <div style="
                        position: absolute;
                        ${c._norm >= 0
                            ? `left: 50%; width: ${barWidth}%;`
                            : `left: ${50 - barWidth}%; width: ${barWidth}%;`
                        }
                        height: 100%;
                        background: ${color};
                        border-radius: 4px;
                        transition: width 0.5s ease, left 0.5s ease;
                    "></div>
                    <!-- Centre line -->
                    <div style="
                        position: absolute; left: 50%; top: 0;
                        width: 1px; height: 100%;
                        background: rgba(255,255,255,0.2);
                    "></div>
                </div>

                <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:10px; color:var(--muted);">
                    <span>Bearish</span>
                    <span>Bullish</span>
                </div>
            </div>
        `;
    }).join("");
}


function renderTable(){
    const tbody = document.getElementById("strengthTable");

    tbody.innerHTML = strengthData.map((c, i) => {
        const color = scoreColor(c._norm);
        const bias  = scoreBias(c._norm);
        const sign  = c.score > 0 ? "+" : "";
        const rank  = i + 1;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
        const barW  = Math.abs(c._norm);

        return `
            <tr>
                <td style="font-weight:700; font-size:16px;">${medal}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:20px;">${FLAGS[c.code] || "🌐"}</span>
                        <span style="font-weight:600;">${c.code}</span>
                    </div>
                </td>
                <td style="font-weight:700; color:${color}; font-variant-numeric:tabular-nums;">
                    ${sign}${c.score.toFixed(4)}%
                </td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="
                            width: 80px; height: 6px;
                            background: rgba(255,255,255,0.05);
                            border-radius: 4px; overflow: hidden;
                        ">
                            <div style="
                                width: ${barW}%;
                                height: 100%;
                                background: ${color};
                                border-radius: 4px;
                            "></div>
                        </div>
                        <span style="font-size:11px; color:var(--muted);">${Math.round(barW)}%</span>
                    </div>
                </td>
                <td>
                    <span style="
                        background: ${c._norm >= 20
                            ? 'rgba(34,197,94,0.12)'
                            : c._norm <= -20
                            ? 'rgba(239,68,68,0.12)'
                            : 'rgba(148,163,184,0.1)'};
                        color: ${color};
                        padding: 4px 12px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: 600;
                    ">${bias}</span>
                </td>
            </tr>
        `;
    }).join("");
}


function renderPairMatrix(){
    const matrix = document.getElementById("pairMatrix");

    // build a score lookup using raw scores
    const scores = {};
    strengthData.forEach(c => scores[c.code] = c.score);

    // also build normalised lookup for colour decisions
    const norms = {};
    strengthData.forEach(c => norms[c.code] = c._norm);

    matrix.innerHTML = PAIRS.map(pair => {
        const base      = pair.slice(0, 3);
        const quote     = pair.slice(3);
        const rawDiff   = (scores[base] || 0) - (scores[quote] || 0);
        const normDiff  = (norms[base]  || 0) - (norms[quote]  || 0);
        const color     = normDiff > 15 ? "#22c55e" : normDiff < -15 ? "#ef4444" : "#94a3b8";
        const bias      = normDiff > 15 ? "Bullish" : normDiff < -15 ? "Bearish" : "Neutral";
        const sign      = rawDiff >= 0 ? "+" : "";

        return `
            <div style="
                background: var(--card);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 14px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: border-color 0.2s;
            ">
                <div>
                    <div style="font-weight:800; font-size:14px; letter-spacing:0.5px;">${pair}</div>
                    <div style="font-size:11px; color:${color}; font-weight:600; margin-top:2px;">${bias}</div>
                </div>
                <div style="
                    background: ${normDiff > 15
                        ? 'rgba(34,197,94,0.12)'
                        : normDiff < -15
                        ? 'rgba(239,68,68,0.12)'
                        : 'rgba(148,163,184,0.1)'};
                    color: ${color};
                    padding: 6px 10px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 700;
                    font-variant-numeric: tabular-nums;
                ">${sign}${rawDiff.toFixed(4)}%</div>
            </div>
        `;
    }).join("");
}


document.getElementById("refreshBtn").addEventListener("click", loadStrength);
window.onload = loadStrength;
