// ─────────────────────────────────────────────────────────────────────
//  Voyager Analytics — landing page 3D layer (three.js)
//
//  1. Hero:    a live, scrolling 3D candlestick chart with a moving average
//  2. Scroll:  the chart recedes and a wireframe market globe takes over —
//              city nodes, trade arcs, and a small rocket orbiting it
//  3. Cards:   subtle 3D tilt on feature cards (desktop pointers only)
//
//  Built to be light: instanced meshes, low-power GPU hint, capped pixel
//  ratio, adaptive quality, reduced-motion support, and a silent fallback
//  if WebGL isn't available (the page simply looks like it did before).
// ─────────────────────────────────────────────────────────────────────
import * as THREE from "three";

// ── Tweak these ──────────────────────────────────────────────────────
const CFG = {
    cyan:   0x00d4ff,
    purple: 0x7b61ff,
    up:     0x22c55e,
    down:   0xef4444,
    bg:     0x070b14,

    candles:        44,     // candles per row
    rows:           3,      // depth rows of candles (2 on mobile)
    candleHeight:   0.6,    // vertical scale of the price series
    tickMs:         1100,   // a new candle every N ms
    particles:      650,

    heroOpacity:    0.5,    // candle opacity over the hero
    restOpacity:    0.1,    // candle opacity once you scroll past it
    globeOpacity:   0.6,    // globe max opacity (desktop)
};

const canvas       = document.getElementById("bg3d");
const isMobile     = matchMedia("(max-width: 720px)").matches;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp  = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp   = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function latLon(lat, lon, r) {
    const phi   = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
         r * Math.cos(phi),
         r * Math.sin(phi) * Math.sin(theta)
    );
}

function initScene() {
    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: !isMobile,
        powerPreference: "low-power"
    });

    let dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const scene  = new THREE.Scene();
    scene.fog    = new THREE.FogExp2(CFG.bg, 0.035);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 3.2, 13);

    let vw = 0, vh = 0;
    function resize(force) {
        const w = window.innerWidth, h = window.innerHeight;
        // Mobile URL bars change innerHeight while scrolling — ignore small height changes
        if (!force && w === vw && Math.abs(h - vh) < 150) return;
        vw = w; vh = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize(true);

    // ═════════════════════════════════════════════════════════════════
    //  Candlestick field
    // ═════════════════════════════════════════════════════════════════
    const rng     = mulberry32(7);
    const N       = CFG.candles;
    const ROWS    = isMobile ? 2 : CFG.rows;
    const SPACING = 0.62;
    const ROW_GAP = 3.2;
    const Y       = CFG.candleHeight;

    const chart  = new THREE.Group();   // moves/recedes with scroll
    const slider = new THREE.Group();   // slides left continuously
    chart.add(slider);
    scene.add(chart);

    const bodyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: CFG.heroOpacity });
    const wickMat = bodyMat.clone();
    const bodies  = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 1, 0.36), bodyMat, N * ROWS);
    const wicks   = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), wickMat, N * ROWS);
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wicks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bodies.frustumCulled = wicks.frustumCulled = false;
    slider.add(bodies, wicks);

    function nextCandle(state) {
        const o = state.p;
        let c = o + (rng() - 0.5) * 1.2 + (4.5 - o) * 0.03;
        c = clamp(c, 0.8, 8);
        state.p = c;
        return {
            o, c,
            h: Math.max(o, c) + rng() * 0.45,
            l: Math.min(o, c) - rng() * 0.45
        };
    }

    const rows = Array.from({ length: ROWS }, (_, r) => {
        const state = { p: 3.5 + r * 0.7 };
        const data  = [];
        for (let i = 0; i < N; i++) data.push(nextCandle(state));
        return { state, data };
    });

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    function writeCandle(r, i, g = 1) {
        const c   = rows[r].data[i];
        const idx = r * N + i;
        const x   = (i - N / 2) * SPACING;
        const z   = -r * ROW_GAP;

        dummy.position.set(x, ((c.o + c.c) / 2) * Y, z);
        dummy.scale.set(1, Math.max(Math.abs(c.c - c.o), 0.06) * Y * g, 1);
        dummy.updateMatrix();
        bodies.setMatrixAt(idx, dummy.matrix);

        dummy.position.y = ((c.h + c.l) / 2) * Y;
        dummy.scale.set(1, (c.h - c.l) * Y * g, 1);
        dummy.updateMatrix();
        wicks.setMatrixAt(idx, dummy.matrix);

        color.setHex(c.c >= c.o ? CFG.up : CFG.down).multiplyScalar(1 - r * 0.2);
        bodies.setColorAt(idx, color);
        wicks.setColorAt(idx, color);
    }

    function flushCandles() {
        bodies.instanceMatrix.needsUpdate = true;
        wicks.instanceMatrix.needsUpdate  = true;
        if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
        if (wicks.instanceColor)  wicks.instanceColor.needsUpdate  = true;
    }

    // Moving average line over the front row's closes
    const MA_PERIOD = 6;
    const maPositions = new Float32Array(N * 3);
    const maGeo = new THREE.BufferGeometry();
    maGeo.setAttribute("position", new THREE.BufferAttribute(maPositions, 3));
    const maMat  = new THREE.LineBasicMaterial({ color: CFG.cyan, transparent: true, opacity: 0.85 });
    const maLine = new THREE.Line(maGeo, maMat);
    maLine.frustumCulled = false;
    slider.add(maLine);

    function updateMA() {
        const d = rows[0].data;
        for (let i = 0; i < N; i++) {
            let sum = 0, n = 0;
            for (let k = Math.max(0, i - MA_PERIOD + 1); k <= i; k++) { sum += d[k].c; n++; }
            maPositions[i * 3]     = (i - N / 2) * SPACING;
            maPositions[i * 3 + 1] = (sum / n) * Y;
            maPositions[i * 3 + 2] = 0.3;
        }
        maGeo.attributes.position.needsUpdate = true;
    }

    for (let r = 0; r < ROWS; r++) for (let i = 0; i < N; i++) writeCandle(r, i);
    flushCandles();
    updateMA();

    // Floor grid
    const grid = new THREE.GridHelper(90, 90, CFG.cyan, CFG.cyan);
    grid.material.transparent = true;
    grid.material.opacity     = 0.07;
    grid.position.set(0, 0, -6);
    chart.add(grid);

    let slide = 0, grow = 1, lastTick = performance.now();

    function tickCandles() {
        for (let r = 0; r < ROWS; r++) {
            rows[r].data.shift();
            rows[r].data.push(nextCandle(rows[r].state));
        }
        for (let r = 0; r < ROWS; r++) for (let i = 0; i < N; i++) writeCandle(r, i, i === N - 1 ? 0.01 : 1);
        flushCandles();
        updateMA();
        slide = SPACING;
        grow  = 0;
    }

    // ═════════════════════════════════════════════════════════════════
    //  Dust
    // ═════════════════════════════════════════════════════════════════
    const PC   = isMobile ? 280 : CFG.particles;
    const pPos = new Float32Array(PC * 3);
    const pCol = new Float32Array(PC * 3);
    const cA = new THREE.Color(CFG.cyan), cB = new THREE.Color(CFG.purple);
    for (let i = 0; i < PC; i++) {
        pPos[i * 3]     = (rng() - 0.5) * 50;
        pPos[i * 3 + 1] = rng() * 18 - 2;
        pPos[i * 3 + 2] = 5 - rng() * 32;
        (i % 3 ? cA : cB).toArray(pCol, i * 3);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color",    new THREE.BufferAttribute(pCol, 3));
    const dustMat = new THREE.PointsMaterial({
        size: 0.06, vertexColors: true, transparent: true, opacity: 0.7,
        depthWrite: false, blending: THREE.AdditiveBlending
    });
    const dust = new THREE.Points(pGeo, dustMat);
    scene.add(dust);

    // ═════════════════════════════════════════════════════════════════
    //  Market globe
    // ═════════════════════════════════════════════════════════════════
    const R         = 2.6;
    const globe     = new THREE.Group();
    const globeMats = [];   // [{ m, base }] — faded together
    const reg = (m, base) => { globeMats.push({ m, base }); return m; };
    scene.add(globe);

    // Dark core hides the far side of the wireframe so it reads as a solid sphere
    const core = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.995, 32, 24),
        reg(new THREE.MeshBasicMaterial({ color: CFG.bg, transparent: true, opacity: 0, depthWrite: true }), 0.92)
    );
    core.renderOrder = 0;
    globe.add(core);

    const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R, 2)),
        reg(new THREE.LineBasicMaterial({ color: CFG.cyan, transparent: true, opacity: 0, depthWrite: false }), 0.22)
    );
    wire.renderOrder = 1;
    globe.add(wire);

    // Fibonacci-sphere dot shell
    const DOTS = isMobile ? 500 : 900;
    const dPos = new Float32Array(DOTS * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < DOTS; i++) {
        const y = 1 - (i / (DOTS - 1)) * 2;
        const rad = Math.sqrt(1 - y * y);
        const a = golden * i;
        dPos[i * 3]     = Math.cos(a) * rad * R * 1.003;
        dPos[i * 3 + 1] = y * R * 1.003;
        dPos[i * 3 + 2] = Math.sin(a) * rad * R * 1.003;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
    const dots = new THREE.Points(
        dotGeo,
        reg(new THREE.PointsMaterial({ color: CFG.cyan, size: 0.035, transparent: true, opacity: 0, depthWrite: false }), 0.8)
    );
    dots.renderOrder = 1;
    globe.add(dots);

    // Financial centres
    const CITIES = [
        { name: "New York",     lat:  40.7, lon:  -74.0 },
        { name: "London",       lat:  51.5, lon:   -0.1 },
        { name: "Johannesburg", lat: -26.2, lon:   28.0, hot: true },
        { name: "Tokyo",        lat:  35.7, lon:  139.7 },
        { name: "Sydney",       lat: -33.9, lon:  151.2 }
    ];
    const nodeGeo = new THREE.SphereGeometry(0.06, 12, 12);
    const nodes   = CITIES.map(c => {
        const m = new THREE.Mesh(
            nodeGeo,
            reg(new THREE.MeshBasicMaterial({ color: c.hot ? CFG.purple : 0xffffff, transparent: true, opacity: 0 }), 1)
        );
        m.position.copy(latLon(c.lat, c.lon, R * 1.01));
        m.renderOrder = 2;
        globe.add(m);
        return m;
    });

    // Trade arcs between centres
    const ARC_PTS = 41;
    const arcs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]].map(([a, b], i) => {
        const p0 = latLon(CITIES[a].lat, CITIES[a].lon, R * 1.01);
        const p1 = latLon(CITIES[b].lat, CITIES[b].lon, R * 1.01);
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        mid.normalize().multiplyScalar(R + 0.5 + p0.distanceTo(p1) * 0.22);
        const geo  = new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(p0, mid, p1).getPoints(ARC_PTS - 1));
        const line = new THREE.Line(
            geo,
            reg(new THREE.LineBasicMaterial({ color: i % 2 ? CFG.purple : CFG.cyan, transparent: true, opacity: 0, depthWrite: false }), 0.9)
        );
        line.renderOrder = 2;
        globe.add(line);
        return { line, phase: i * 0.31 };
    });

    // Rocket (the Voyager logo, in 3D) — orbits the globe
    const orbit  = new THREE.Group();
    orbit.rotation.set(0.55, 0, 0.35);
    const rocket = new THREE.Group();
    const rMat   = (c, base = 1) => reg(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0 }), base);
    const rBody  = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 12), rMat(0xe2e8f0));
    const rNose  = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 12), rMat(CFG.cyan));
    rNose.position.y = 0.26;
    rocket.add(rBody, rNose);
    for (let i = 0; i < 3; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.09), rMat(CFG.purple));
        const a = (i / 3) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 0.075, -0.14, Math.sin(a) * 0.075);
        fin.rotation.y = -a;
        rocket.add(fin);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 10), rMat(0xf59e0b, 0.9));
    flame.rotation.z = Math.PI;
    flame.position.y = -0.28;
    rocket.add(flame);
    rocket.scale.setScalar(1.3);
    orbit.add(rocket);
    globe.add(orbit);

    function setGlobeOpacity(o) {
        globe.visible = o > 0.01;
        for (const { m, base } of globeMats) m.opacity = o * base;
    }
    setGlobeOpacity(0);

    // ═════════════════════════════════════════════════════════════════
    //  Input + scroll
    // ═════════════════════════════════════════════════════════════════
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    window.addEventListener("pointermove", e => {
        mouse.tx = (e.clientX / window.innerWidth)  * 2 - 1;
        mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    let scrollT = 0, scrollSmooth = 0, pageP = 0;
    function readScroll() {
        const heroH = window.innerHeight * 0.9;
        scrollT = clamp((window.scrollY - heroH * 0.3) / (heroH * 0.9), 0, 1);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        pageP = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    }
    readScroll();
    window.addEventListener("scroll", readScroll, { passive: true });

    // ═════════════════════════════════════════════════════════════════
    //  Frame
    // ═════════════════════════════════════════════════════════════════
    const lookAt = new THREE.Vector3(0, 2.6, 0);
    const maxGlobe = isMobile ? 0.32 : CFG.globeOpacity;

    function renderFrame(time, dt) {
        // smooth scroll + pointer
        scrollSmooth += (scrollT - scrollSmooth) * (reduceMotion ? 1 : 0.08);
        mouse.x += (mouse.tx - mouse.x) * 0.05;
        mouse.y += (mouse.ty - mouse.y) * 0.05;
        const t = scrollSmooth;

        // candles: new tick, slide, grow-in
        if (!reduceMotion) {
            if (time - lastTick > CFG.tickMs) { lastTick = time; tickCandles(); }
            slide = Math.max(0, slide - SPACING * (dt / CFG.tickMs));
            if (grow < 1) {
                grow = Math.min(1, grow + dt / (CFG.tickMs * 0.6));
                const g = 1 - Math.pow(1 - grow, 3);
                for (let r = 0; r < ROWS; r++) writeCandle(r, N - 1, g);
                flushCandles();
            }
        }
        slider.position.x = slide;

        // chart recedes as you scroll
        const co = lerp(CFG.heroOpacity, CFG.restOpacity, smooth(0, 1, t));
        bodyMat.opacity = wickMat.opacity = co;
        maMat.opacity   = co * 1.6;
        chart.position.set(0, lerp(-2.2, -3, t), -t * 12);
        chart.rotation.y = t * 0.5;
        dustMat.opacity  = lerp(0.7, 0.35, t);

        // globe fades in, sways left/right with page position, spins
        const go = smooth(0.2, 0.85, t) * maxGlobe;
        setGlobeOpacity(go);
        if (globe.visible) {
            const sway = isMobile ? 0 : Math.cos(pageP * Math.PI * 4) * 5;
            globe.position.set(sway, isMobile ? 4.2 : 2.6, 0);
            globe.rotation.y = time * 0.00012 + pageP * Math.PI * 2;
            globe.rotation.x = 0.25;

            const s = time * 0.001;
            nodes.forEach((n, i) => n.scale.setScalar(1 + 0.4 * Math.sin(s * 3 + i)));
            arcs.forEach(a => {
                const p = (s * 0.4 + a.phase) % 1.5;
                a.line.geometry.setDrawRange(0, Math.floor(Math.min(1, p) * ARC_PTS));
            });

            const ang = s * 0.9;
            rocket.position.set(Math.cos(ang) * (R + 0.85), Math.sin(ang) * (R + 0.85), 0);
            rocket.rotation.z = ang;
            flame.scale.set(1, 0.8 + 0.4 * Math.sin(s * 30), 1);
        }

        // dust drift
        dust.rotation.y = time * 0.00004;

        // camera parallax
        camera.position.x = mouse.x * 1.2;
        camera.position.y = 3.2 - mouse.y * 0.6;
        camera.lookAt(lookAt);

        renderer.render(scene, camera);
    }

    // ═════════════════════════════════════════════════════════════════
    //  Loop (with adaptive quality)
    // ═════════════════════════════════════════════════════════════════
    window.addEventListener("resize", () => { resize(false); if (reduceMotion) requestStatic(); });

    if (reduceMotion) {
        // One static frame; re-render only when scroll/resize changes the view
        let queued = false;
        var requestStatic = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; renderFrame(performance.now(), 0); });
        };
        window.addEventListener("scroll", requestStatic, { passive: true });
        renderFrame(performance.now(), 0);
        return;
    }

    let last = performance.now(), frames = 0, acc = 0, quality = 0;
    function loop(now) {
        const dt = Math.min(now - last, 100);
        last = now;
        renderFrame(now, dt);

        // Every ~90 frames, check average frame time and step quality down if needed
        if (dt < 200) { acc += dt; frames++; }
        if (frames >= 90) {
            const avg = acc / frames;
            frames = acc = 0;
            if (avg > 26 && quality === 0) {
                quality = 1;
                dpr = 1;
                renderer.setPixelRatio(1);
                resize(true);
            } else if (avg > 34 && quality === 1) {
                quality = 2;
                dust.visible = false;
                grid.visible = false;
            }
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

// ═════════════════════════════════════════════════════════════════════
//  Card tilt (desktop pointers only)
// ═════════════════════════════════════════════════════════════════════
function initTilt() {
    if (reduceMotion || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    document.querySelectorAll(".feature-card, .step").forEach(el => {
        let timer = null;
        el.addEventListener("pointermove", e => {
            clearTimeout(timer);
            const r = el.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width  - 0.5;
            const y = (e.clientY - r.top)  / r.height - 0.5;
            el.style.transition = "transform .08s ease-out";
            el.style.transform  = `perspective(700px) rotateX(${(-y * 9).toFixed(2)}deg) rotateY(${(x * 11).toFixed(2)}deg) translateY(-4px)`;
        });
        el.addEventListener("pointerleave", () => {
            el.style.transition = "transform .35s ease";
            el.style.transform  = "";
            timer = setTimeout(() => { el.style.transition = ""; }, 380);
        });
    });
}

// ── Boot ─────────────────────────────────────────────────────────────
if (canvas) {
    try {
        initScene();
    } catch (err) {
        // No WebGL (or it failed): drop the canvas, the page is unchanged
        console.warn("3D background disabled:", err);
        canvas.remove();
    }
}
initTilt();