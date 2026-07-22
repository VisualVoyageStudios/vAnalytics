const token = localStorage.token;
if(!token) window.location.href = "../login.html";

const CURRENCIES = [
    { code:"USD", flag:"🇺🇸" },
    { code:"EUR", flag:"🇪🇺" },
    { code:"GBP", flag:"🇬🇧" },
    { code:"JPY", flag:"🇯🇵" },
    { code:"AUD", flag:"🇦🇺" },
    { code:"CAD", flag:"🇨🇦" },
    { code:"NZD", flag:"🇳🇿" },
    { code:"CHF", flag:"🇨🇭" },
];

const METALS = [
    { code:"XAU", flag:"", name:"Gold"     },
    { code:"XAG", flag:"", name:"Silver"   },
    { code:"XPT", flag:"", name:"Platinum" },
    { code:"XCU", flag:"", name:"Copper"   },
];

const BIAS_CONFIG = {
    "Very Bullish": { color:"#22c55e", bg:"rgba(34,197,94,0.12)",  border:"rgba(34,197,94,0.3)"  },
    "Bullish":      { color:"#86efac", bg:"rgba(34,197,94,0.08)",  border:"rgba(34,197,94,0.2)"  },
    "Neutral":      { color:"#94a3b8", bg:"rgba(148,163,184,0.08)",border:"rgba(148,163,184,0.2)"},
    "Bearish":      { color:"#fca5a5", bg:"rgba(239,68,68,0.08)",  border:"rgba(239,68,68,0.2)"  },
    "Very Bearish": { color:"#ef4444", bg:"rgba(239,68,68,0.12)",  border:"rgba(239,68,68,0.3)"  },
};

let activeAsset = "USD";


// ── Build asset tabs ─────────────────────────────────────────────────

function buildTabs(){
    const ccyDiv   = document.getElementById("ccy-tabs");
    const metalDiv = document.getElementById("metal-tabs");

    ccyDiv.innerHTML = CURRENCIES.map(c => `
        <button class="asset-tab ${c.code === activeAsset ? "active" : ""}"
            data-asset="${c.code}"
            onclick="switchAsset('${c.code}')"
            style="
                padding:8px 14px; border-radius:20px; font-size:13px; font-weight:600;
                cursor:pointer;
                border:1px solid ${c.code === activeAsset ? "var(--primary)" : "var(--border)"};
                background:${c.code === activeAsset ? "rgba(59,130,246,0.12)" : "var(--card)"};
                color:${c.code === activeAsset ? "white" : "var(--muted)"};
                transition:all 0.2s;
            ">
            ${c.flag} ${c.code}
        </button>
    `).join("");

    metalDiv.innerHTML = METALS.map(m => `
        <button class="asset-tab ${m.code === activeAsset ? "active" : ""}"
            data-asset="${m.code}"
            onclick="switchAsset('${m.code}')"
            style="
                padding:8px 14px; border-radius:20px; font-size:13px; font-weight:600;
                cursor:pointer;
                border:1px solid ${m.code === activeAsset ? "#f59e0b" : "var(--border)"};
                background:${m.code === activeAsset ? "rgba(245,158,11,0.12)" : "var(--card)"};
                color:${m.code === activeAsset ? "#f59e0b" : "var(--muted)"};
                transition:all 0.2s;
            ">
            ${m.flag} ${m.name}
        </button>
    `).join("");
}


function switchAsset(asset){
    activeAsset = asset;
    buildTabs();
    loadScorecard(asset);
}


// ── Load scorecard ───────────────────────────────────────────────────

async function loadScorecard(asset){
    document.getElementById("scorecard-loading").style.display = "block";
    document.getElementById("scorecard-content").style.display = "none";

    try {
        const res  = await fetch(`${API_URL}/fundamentals/scorecard?asset=${asset}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        renderGauge(data.composite);
        renderScoreBreakdown(data);
        renderSectionSummary(data.sections);
        renderCOT(data.sections.cot);
        renderSectionTables(data.sections);

        document.getElementById("ef-last-updated").textContent =
            `Updated ${new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;

        document.getElementById("scorecard-loading").style.display = "none";
        document.getElementById("scorecard-content").style.display = "block";

    } catch(err) {
        console.error(err);
        document.getElementById("scorecard-loading").innerHTML = `
            <i class="fas fa-triangle-exclamation" style="font-size:2rem; display:block; margin-bottom:12px; opacity:0.3;"></i>
            Could not load scorecard. Please refresh.
        `;
    }
}


// ── Gauge ────────────────────────────────────────────────────────────

function renderGauge(composite){
    // composite is -1 to +1, scale to -10 to +10 display
    const score     = Math.round(composite * 10);
    const bias      = getBiasLabel(composite);
    const cfg       = BIAS_CONFIG[bias];

    // needle rotation: -90° = fully bearish (-1), 0° = neutral, +90° = fully bullish (+1)
    const rotation  = composite * 90;

    // fill arc length (total arc = ~251px for r=80)
    const ARC       = 251;
    const fillPct   = (composite + 1) / 2; // 0 to 1
    const fillLen   = Math.round(fillPct * ARC);

    const needle    = document.getElementById("gauge-needle");
    const fill      = document.getElementById("gauge-fill");
    const scoreEl   = document.getElementById("gauge-score");
    const labelEl   = document.getElementById("gauge-label");

    if(needle) needle.setAttribute("transform", `rotate(${rotation}, 100, 100)`);

    if(fill){
        fill.setAttribute("stroke-dasharray", `${fillLen} ${ARC}`);
        fill.setAttribute("stroke", cfg.color);
    }

    if(scoreEl){
        scoreEl.textContent = score > 0 ? `+${score}` : score;
        scoreEl.style.color = cfg.color;
    }

    if(labelEl){
        labelEl.textContent        = bias;
        labelEl.style.color        = cfg.color;
        labelEl.style.background   = cfg.bg;
        labelEl.style.border       = `1px solid ${cfg.border}`;
    }
}


function getBiasLabel(composite){
    if(composite >= 0.6)  return "Very Bullish";
    if(composite >= 0.2)  return "Bullish";
    if(composite <= -0.6) return "Very Bearish";
    if(composite <= -0.2) return "Bearish";
    return "Neutral";
}


// ── Score breakdown (left panel below gauge) ─────────────────────────

function renderScoreBreakdown(data){
    const container = document.getElementById("score-breakdown");
    const sections  = data.sections;

    const rows = [
        { label: "Growth score",    score: sections.growth?.score    ?? 0 },
        { label: "Inflation score", score: sections.inflation?.score ?? 0 },
        { label: "Jobs score",      score: sections.jobs?.score      ?? 0 },
        { label: "COT score",       score: sections.cot?.score       ?? 0 },
        { label: "Macro score",     score: (data.macro_score ?? 0) / 10  },
    ];

    container.innerHTML = rows.map(r => {
        const col  = r.score > 0 ? "#22c55e" : r.score < 0 ? "#ef4444" : "#94a3b8";
        const sign = r.score > 0 ? "+" : "";
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;
                padding:6px 10px; background:rgba(255,255,255,0.03); border-radius:8px;">
                <span style="font-size:11px; color:var(--muted);">${r.label}</span>
                <span style="font-size:12px; font-weight:700; color:${col};">${sign}${r.score.toFixed(2)}</span>
            </div>
        `;
    }).join("");
}


// ── Section summary cards ────────────────────────────────────────────

function renderSectionSummary(sections){
    const container = document.getElementById("section-summary");

    const cards = [
        { key:"growth",    icon:"fa-chart-line",     label:"Economic Growth"  },
        { key:"inflation", icon:"fa-fire",            label:"Inflation"        },
        { key:"jobs",      icon:"fa-briefcase",       label:"Jobs Market"      },
        { key:"cot",       icon:"fa-scale-unbalanced",label:"COT Positioning"  },
    ];

    container.innerHTML = cards.map(c => {
        const section = sections[c.key] || {};
        const bias    = section.bias || (section.has_data === false ? "No Data" : "Neutral");
        const cfg     = BIAS_CONFIG[bias] || BIAS_CONFIG["Neutral"];
        const score   = section.score ?? 0;
        const sign    = score > 0 ? "+" : "";

        return `
            <div style="
                background:${cfg.bg};
                border:1px solid ${cfg.border};
                border-radius:14px;
                padding:20px;
                position:relative;
                overflow:hidden;
            ">
                <div style="position:absolute; top:0; left:0; right:0; height:3px; background:${cfg.color};"></div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                    <div>
                        <div style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                            <i class="fas ${c.icon}" style="margin-right:4px;"></i>${c.label}
                        </div>
                        <div style="font-size:16px; font-weight:700; color:${cfg.color};">${bias}</div>
                    </div>
                    <div style="font-size:1.4rem; font-weight:800; color:${cfg.color};">${sign}${score.toFixed(2)}</div>
                </div>
                <div style="background:rgba(255,255,255,0.05); border-radius:4px; height:4px; overflow:hidden;">
                    <div style="
                        width:${Math.abs(score) * 100}%;
                        height:100%;
                        background:${cfg.color};
                        border-radius:4px;
                        float:${score >= 0 ? 'left' : 'right'};
                    "></div>
                </div>
            </div>
        `;
    }).join("");
}


// ── COT row ──────────────────────────────────────────────────────────

function renderCOT(cot){
    const container = document.getElementById("cot-row");

    if(!cot || !cot.has_data){
        container.innerHTML = `
            <div style="
                background:var(--card); border:1px solid var(--border);
                border-radius:14px; padding:18px 22px;
                display:flex; align-items:center; gap:12px;
                font-size:13px; color:var(--muted);
            ">
                <i class="fas fa-scale-unbalanced" style="font-size:16px; opacity:0.3;"></i>
                COT positioning data not available for this asset.
                ${activeAsset in {USD:1,EUR:1,GBP:1,JPY:1,AUD:1,CAD:1,NZD:1,CHF:1}
                    ? '<a href="cotPositioning.html" style="color:var(--primary); margin-left:8px;">View COT page →</a>'
                    : ""}
            </div>
        `;
        return;
    }

    const isLong  = cot.net_position >= 0;
    const col     = isLong ? "#22c55e" : "#ef4444";
    const longPct = cot.long_pct  || 0;
    const shrtPct = cot.short_pct || 0;
    const change  = cot.change    || 0;
    const sign    = change > 0 ? "+" : "";

    container.innerHTML = `
        <div style="
            background:var(--card); border:1px solid var(--border);
            border-radius:14px; padding:20px 24px;
        ">
            <div style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;
                letter-spacing:0.5px; margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                <i class="fas fa-scale-unbalanced" style="color:var(--primary);"></i>
                COT — Institutional Positioning (Large Speculators)
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:16px;">
                <div style="text-align:center; background:rgba(255,255,255,0.03); border-radius:10px; padding:14px;">
                    <div style="font-size:1.4rem; font-weight:800; color:${col};">
                        ${isLong ? "+" : ""}${(cot.net_position || 0).toLocaleString()}
                    </div>
                    <div style="font-size:11px; color:var(--muted); margin-top:4px;">Net Position</div>
                </div>
                <div style="text-align:center; background:rgba(34,197,94,0.06); border-radius:10px; padding:14px;">
                    <div style="font-size:1.4rem; font-weight:800; color:#22c55e;">${longPct}%</div>
                    <div style="font-size:11px; color:var(--muted); margin-top:4px;">Long %</div>
                </div>
                <div style="text-align:center; background:rgba(239,68,68,0.06); border-radius:10px; padding:14px;">
                    <div style="font-size:1.4rem; font-weight:800; color:#ef4444;">${shrtPct}%</div>
                    <div style="font-size:11px; color:var(--muted); margin-top:4px;">Short %</div>
                </div>
                <div style="text-align:center; background:rgba(255,255,255,0.03); border-radius:10px; padding:14px;">
                    <div style="font-size:1.4rem; font-weight:800; color:${change > 0 ? "#22c55e" : change < 0 ? "#ef4444" : "#94a3b8"};">
                        ${sign}${(change || 0).toLocaleString()}
                    </div>
                    <div style="font-size:11px; color:var(--muted); margin-top:4px;">Week Change</div>
                </div>
            </div>
            <!-- Long/Short bar -->
            <div style="background:rgba(239,68,68,0.3); border-radius:6px; height:10px; overflow:hidden; position:relative;">
                <div style="
                    position:absolute; left:0; top:0; height:100%;
                    width:${longPct}%;
                    background:#22c55e;
                    border-radius:6px;
                    transition: width 0.5s ease;
                "></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:10px; color:var(--muted);">
                <span>🟢 Longs ${longPct}%</span>
                <span>${shrtPct}% Shorts 🔴</span>
            </div>
        </div>
    `;
}


// ── Section detail tables ────────────────────────────────────────────

function renderSectionTables(sections){
    const container = document.getElementById("section-tables");

    const defs = [
        { key:"growth",    icon:"fa-seedling",   label:"Economic Growth Bias",   color:"#3b82f6" },
        { key:"inflation", icon:"fa-fire",        label:"Inflation Bias",         color:"#f59e0b" },
        { key:"jobs",      icon:"fa-user-tie",    label:"Jobs Market Bias",       color:"#22c55e" },
    ];

    container.innerHTML = defs.map(def => {
        const section = sections[def.key] || {};
        const items   = section.items || [];
        const bias    = section.bias  || "Neutral";
        const cfg     = BIAS_CONFIG[bias] || BIAS_CONFIG["Neutral"];

        if(items.length === 0) return "";

        const rows = items.map(item => {
            const itemCfg  = BIAS_CONFIG[item.bias.charAt(0).toUpperCase() + item.bias.slice(1)] || BIAS_CONFIG["Neutral"];
            const surprise = item.data?.surprise;
            const supSign  = surprise > 0 ? "+" : "";
            const supColor = surprise > 0 ? "#22c55e" : surprise < 0 ? "#ef4444" : "#94a3b8";

            return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                    <td style="padding:12px 16px; font-size:13px; color:var(--muted);">${item.label}</td>
                    <td style="padding:12px 16px;">
                        <span style="
                            padding:3px 12px; border-radius:20px; font-size:11px; font-weight:700;
                            background:${itemCfg.bg}; color:${itemCfg.color};
                            border:1px solid ${itemCfg.border};
                        ">${item.bias.charAt(0).toUpperCase() + item.bias.slice(1)}</span>
                    </td>
                    <td style="padding:12px 16px; font-size:13px; font-weight:600; color:white; text-align:right;">
                        ${item.data?.actual || "—"}
                    </td>
                    <td style="padding:12px 16px; font-size:13px; color:var(--muted); text-align:right;">
                        ${item.data?.forecast || "—"}
                    </td>
                    <td style="padding:12px 16px; font-size:13px; font-weight:700; color:${supColor}; text-align:right;">
                        ${surprise !== null && surprise !== undefined ? `${supSign}${surprise}` : "—"}
                    </td>
                </tr>
            `;
        }).join("");

        return `
            <div style="
                background:var(--card); border:1px solid var(--border);
                border-radius:14px; overflow:hidden;
            ">
                <div style="
                    display:flex; justify-content:space-between; align-items:center;
                    padding:16px 20px; border-bottom:1px solid var(--border);
                    background:rgba(255,255,255,0.02);
                ">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="fas ${def.icon}" style="color:${def.color}; font-size:14px;"></i>
                        <span style="font-size:14px; font-weight:700;">${def.label}</span>
                    </div>
                    <span style="
                        padding:4px 14px; border-radius:20px; font-size:12px; font-weight:700;
                        background:${cfg.bg}; color:${cfg.color}; border:1px solid ${cfg.border};
                    ">${bias}</span>
                </div>
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:rgba(255,255,255,0.01);">
                            <th style="padding:10px 16px; text-align:left; font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Indicator</th>
                            <th style="padding:10px 16px; text-align:left; font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Bias</th>
                            <th style="padding:10px 16px; text-align:right; font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Actual</th>
                            <th style="padding:10px 16px; text-align:right; font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Forecast</th>
                            <th style="padding:10px 16px; text-align:right; font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Surprise</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }).join("");
}


// ── Init ─────────────────────────────────────────────────────────────
buildTabs();
loadScorecard(activeAsset);
