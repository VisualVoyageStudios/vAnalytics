const token = localStorage.token;
if(!token) window.location.href = "../login.html";
 
async function loadJournals(){

    const journals = await getJournals(token);
    const trades   = await getTrades(token);

    const container = document.getElementById("journalList");
    container.innerHTML = "";

    if(journals.length === 0){
        container.innerHTML = `
            <div style="text-align: center; color: var(--muted); padding: 60px 20px;">
                <i class="fas fa-book-open" style="font-size: 2rem; margin-bottom: 16px; display: block; opacity: 0.3;"></i>
                <p>No journal entries yet. Log your first trade above.</p>
            </div>
        `;
        return;
    }

    journals.forEach(entry => {

        const trade = trades.find(t => t.id === entry.trade_id);

        const profitColor = trade
            ? trade.profit >= 0
                ? "var(--success)"
                : "var(--danger)"
            : "var(--muted)";

        const tradeLabel = trade
            ? `${trade.symbol} · ${trade.order_type} · $${trade.profit}`
            : "Trade not found";

        const emotionColors = {
            "Confident":   { bg: "rgba(34,197,94,0.1)",   color: "#22c55e" },
            "Calm":        { bg: "rgba(59,130,246,0.1)",   color: "#3b82f6" },
            "Fearful":     { bg: "rgba(239,68,68,0.1)",    color: "#ef4444" },
            "Greedy":      { bg: "rgba(234,179,8,0.1)",    color: "#f0bf2d" },
            "Frustrated":  { bg: "rgba(249,115,22,0.1)",   color: "#f95e16" }
        };

        const emotionStyle = emotionColors[entry.emotion] || {
            bg: "rgba(148,163,184,0.1)",
            color: "var(--muted)"
        };

        const ratingColor = entry.rating >= 7
            ? "var(--success)"
            : entry.rating >= 4
                ? "#eab308"
                : "var(--danger)";

        const card = document.createElement("div");
        card.className = "metric-card";
        card.style.marginBottom = "16px";

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">

                <span style="
                    background: ${emotionStyle.bg};
                    color: ${emotionStyle.color};
                    padding: 6px 14px;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 600;
                ">${entry.emotion}</span>

                <span style="
                    font-size: 13px;
                    font-weight: 700;
                    color: ${ratingColor};
                ">
                    ${entry.rating}/10
                </span>

            </div>

            <div style="
                background: var(--sidebar);
                border-radius: 10px;
                padding: 12px 16px;
                margin-bottom: 14px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <span style="font-size: 13px; color: var(--muted);">
                    <i class="fas fa-chart-line" style="margin-right: 6px;"></i>
                    ${tradeLabel}
                </span>
                <span style="font-weight: 700; color: ${profitColor}; font-size: 13px;">
                    ${trade ? (trade.profit >= 0 ? "WIN" : "LOSS") : ""}
                </span>
            </div>

            ${entry.lesson ? `
            <div style="margin-bottom: 10px;">
                <p style="font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Lesson</p>
                <p style="font-size: 14px; line-height: 1.6;">${entry.lesson}</p>
            </div>` : ""}

            ${entry.mistake ? `
            <div>
                <p style="font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Mistake</p>
                <p style="font-size: 14px; line-height: 1.6;">${entry.mistake}</p>
            </div>` : ""}
        `;

        container.appendChild(card);
    });
}

document
.getElementById(
    "journalForm"
)
.addEventListener(
    "submit",
    async(e)=>{e.preventDefault();
        
        await createJournal(
            token,
            {

                trade_id:
                document.getElementById(
                    "tradeId"
                ).value,

                emotion:
                document.getElementById(
                    "emotion"
                ).value,

                lesson:
                document.getElementById(
                    "lesson"
                ).value,

                mistake:
                document.getElementById(
                    "mistake"
                ).value,

                rating:
                document.getElementById(
                    "rating"
                ).value

            }
        );

        loadJournals();

        document
        .getElementById(
            "journalForm"
        )
        .reset();

    }
);



async function loadTradeOptions(){

    const trades =
    await getTrades(token);

    const select =
    document.getElementById(
        "tradeId"
    );

    trades.forEach(trade=>{

        const option =
        document.createElement(
            "option"
        );

        option.value =
        trade.id;

        option.textContent =

            `${trade.symbol}
             (${trade.order_type})
             Profit:
             ${trade.profit}`;

        select.appendChild(
            option
        );

    });

}



let templates = { defaults: { lesson: [], mistake: [] }, custom: { lesson: [], mistake: [] } };

async function loadTemplates(){
    try {
        const res  = await fetch(`${API_URL}/journals/templates`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        templates = await res.json();
        renderChips("lesson");
        renderChips("mistake");
    } catch(err) {
        console.error("Templates load failed:", err);
    }
}

function renderChips(field){
    const container = document.getElementById(`${field}Chips`);
    container.innerHTML = "";

    const allChips = [
        ...templates.defaults[field].map(text => ({ text, custom: false, id: null })),
        ...templates.custom[field].map(t   => ({ text: t.text, custom: true, id: t.id }))
    ];

    allChips.forEach(chip => {
        const btn = document.createElement("button");
        btn.type  = "button";
        btn.style.cssText = `
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid ${chip.custom ? "rgba(59,130,246,0.4)" : "var(--border)"};
            background: ${chip.custom ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.04)"};
            color: ${chip.custom ? "#3b82f6" : "var(--muted)"};
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        btn.innerHTML = chip.custom
            ? `${chip.text} <span data-id="${chip.id}" data-field="${field}" style="opacity:0.6; font-size:10px;">✕</span>`
            : chip.text;

        // click chip → append to textarea
        btn.addEventListener("click", (e) => {
            if(e.target.tagName === "SPAN") return; // let delete handle it
            const ta  = document.getElementById(field);
            const sep = ta.value.trim() ? ". " : "";
            ta.value += sep + chip.text;
            ta.focus();
        });

        // delete custom chip
        const deleteSpan = btn.querySelector("span[data-id]");
        if(deleteSpan){
            deleteSpan.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = deleteSpan.dataset.id;
                try {
                    await fetch(`${API_URL}/journals/templates/${id}`, {
                        method: "DELETE",
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    await loadTemplates();
                } catch(err) {
                    console.error("Delete template failed:", err);
                }
            });
        }

        container.appendChild(btn);
    });
}

async function saveCustomTemplate(field){
    const input = document.getElementById(`custom${field.charAt(0).toUpperCase() + field.slice(1)}Input`);
    const text  = input.value.trim();
    if(!text) return;

    try {
        await fetch(`${API_URL}/journals/templates`, {
            method: "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ field, text })
        });
        input.value = "";
        await loadTemplates();
    } catch(err) {
        console.error("Save template failed:", err);
    }
}

document.getElementById("addLessonBtn")
    .addEventListener("click", () => saveCustomTemplate("lesson"));

document.getElementById("addMistakeBtn")
    .addEventListener("click", () => saveCustomTemplate("mistake"));


// Load mistakes
const SEVERITY_CONFIG = {
    high:   { color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   label: "High"   },
    medium: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  label: "Medium" },
    low:    { color: "#3b82f6", bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.2)",  label: "Low"    }
};

const FREQUENCY_ICONS = {
    frequent:   "🔴",
    occasional: "🟡",
    rare:       "🟢"
};

async function loadMistakePatterns(){
    const container = document.getElementById("patternsList");

    container.innerHTML = `
        <div style="color:var(--muted); padding:40px 20px; text-align:center;">
            <i class="fas fa-spinner fa-spin" style="font-size:1.5rem; display:block; margin-bottom:12px; opacity:0.3;"></i>
            Analysing your journal entries…
        </div>
    `;

    try {
        const res  = await fetch(`${API_URL}/journals/mistake-patterns`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        if(data.insufficient_data){
            container.innerHTML = `
                <div style="
                    background: rgba(59,130,246,0.06);
                    border: 1px solid rgba(59,130,246,0.15);
                    border-radius: 14px;
                    padding: 28px;
                    text-align: center;
                    color: var(--muted);
                ">
                    <i class="fas fa-brain" style="font-size:2rem; opacity:0.2; display:block; margin-bottom:12px;"></i>
                    <p style="margin-bottom:6px; color:white; font-weight:600;">Not enough data yet</p>
                    <p style="font-size:13px;">
                        Add ${data.entries_needed} more journal ${data.entries_needed === 1 ? "entry" : "entries"} with mistake notes to unlock pattern analysis.
                    </p>
                </div>
            `;
            return;
        }

        if(!data.patterns || data.patterns.length === 0){
            container.innerHTML = `
                <div style="text-align:center; color:var(--muted); padding:40px 20px;">
                    <i class="fas fa-check-circle" style="font-size:2rem; color:var(--success); display:block; margin-bottom:12px; opacity:0.6;"></i>
                    <p>No clear recurring patterns found — great discipline!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <p style="font-size:12px; color:var(--muted); margin-bottom:16px;">
                Based on ${data.entries_analysed} journal entries
            </p>
            ${data.patterns.map(p => {
                const cfg  = SEVERITY_CONFIG[p.severity] || SEVERITY_CONFIG.medium;
                const freq = FREQUENCY_ICONS[p.frequency] || "🟡";

                return `
                    <div style="
                        background: ${cfg.bg};
                        border: 1px solid ${cfg.border};
                        border-radius: 14px;
                        padding: 20px 24px;
                        margin-bottom: 12px;
                        position: relative;
                        overflow: hidden;
                    ">
                        <div style="
                            position: absolute;
                            top: 0; left: 0; bottom: 0;
                            width: 3px;
                            background: ${cfg.color};
                            border-radius: 14px 0 0 14px;
                        "></div>

                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                            <div>
                                <span style="font-size:12px; margin-right:6px;">${freq}</span>
                                <strong style="font-size:15px;">${p.pattern}</strong>
                            </div>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <span style="
                                    font-size:11px; font-weight:700;
                                    color:${cfg.color};
                                    background:${cfg.bg};
                                    padding: 3px 10px;
                                    border-radius: 20px;
                                    border: 1px solid ${cfg.border};
                                ">${cfg.label} severity</span>
                                <span style="font-size:11px; color:var(--muted); text-transform:capitalize;">${p.frequency}</span>
                            </div>
                        </div>

                        <p style="font-size:13px; color:var(--muted); line-height:1.7; margin-bottom:12px;">
                            ${p.description}
                        </p>

                        <div style="
                            background: rgba(255,255,255,0.03);
                            border-radius: 8px;
                            padding: 10px 14px;
                            display: flex;
                            align-items: flex-start;
                            gap: 8px;
                        ">
                            <i class="fas fa-lightbulb" style="color:#f59e0b; margin-top:2px; font-size:12px; flex-shrink:0;"></i>
                            <p style="font-size:12px; color:white; line-height:1.6; margin:0;">${p.advice}</p>
                        </div>
                    </div>
                `;
            }).join("")}
        `;

    } catch(err) {
        console.error(err);
        container.innerHTML = `
            <div style="text-align:center; color:var(--muted); padding:40px 20px;">
                <i class="fas fa-triangle-exclamation" style="font-size:1.5rem; opacity:0.3; display:block; margin-bottom:12px;"></i>
                Could not load pattern analysis. Try again.
            </div>
        `;
    }
}

document.getElementById("refreshPatternsBtn")
    .addEventListener("click", async () => {
        // bust the server-side cache by waiting — or just re-request
        // (cache will serve existing result for 1hr unless server restarts)
        await loadMistakePatterns();
    });







window.onload =
async()=>{
    await loadTradeOptions();
    await loadJournals();
    await loadTemplates();
    await loadMistakePatterns();
 
};
