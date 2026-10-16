/**
 * ==========================================================================
 * PAGE ART
 * ==========================================================================
 * Every page of the 3D book is drawn here into a canvas, then uploaded as a
 * texture. Nothing is an image file: each spread is generated at runtime from
 * the project data, so the typography stays crisp at any resolution and the
 * whole portfolio still ships as code rather than a folder of screenshots.
 *
 * Each project also gets its own generated artwork — a small abstract drawing
 * that says something true about what the project does (a node graph for the
 * route optimiser, a particle field for the GPU engine, a receipt for the
 * restaurant) rather than a stock placeholder.
 *
 * @module page-art
 */

/** Page pixel size. 1:1.414 is the A-series ratio, so spreads look like paper. */
export const PAGE_W = 1024;
export const PAGE_H = 1448;

const FONTS = {
    display: '"Syncopate", sans-serif',
    body: '"Space Grotesk", sans-serif',
    mono: '"Share Tech Mono", monospace'
};

/** Waits for the self-hosted faces so canvas text is not drawn in a fallback. */
export async function ensureFonts() {
    if (!document.fonts) return;
    await Promise.all([
        document.fonts.load('700 72px "Syncopate"'),
        document.fonts.load('400 32px "Space Grotesk"'),
        document.fonts.load('600 32px "Space Grotesk"'),
        document.fonts.load('400 24px "Share Tech Mono"')
    ]).catch(() => {});
    await document.fonts.ready.catch(() => {});
}

/* --------------------------------------------------------------------------
   DRAWING HELPERS
   -------------------------------------------------------------------------- */

let RESOLUTION = 1;

/**
 * Sets the pixel scale for generated pages. Twelve 1024x1448 textures is ~70MB
 * of VRAM once mipmapped, which is more than a budget phone should be asked
 * for, so the caller drops this on small screens.
 * @param {number} scale
 */
export function setPageResolution(scale) { RESOLUTION = scale; }

function makeCanvas() {
    const c = document.createElement('canvas');
    c.width = Math.round(PAGE_W * RESOLUTION);
    c.height = Math.round(PAGE_H * RESOLUTION);
    const ctx = c.getContext('2d');
    // Everything below draws in logical page units regardless of resolution.
    ctx.scale(RESOLUTION, RESOLUTION);
    return c;
}

/** Word-wraps `text` and returns the y position after the last line. */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            y += lineHeight;
            line = word;
        } else {
            line = test;
        }
    }
    if (line) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
}

/** Rounded rectangle path, for chips and panels. */
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Subtle paper grain, so a flat fill does not read as plastic. */
function addGrain(ctx, amount = 9) {
    const { width: w, height: h } = ctx.canvas;
    // getImageData works in device pixels, so the transform is reset first.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() - 0.5) * amount;
        data[i] += n; data[i + 1] += n; data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    ctx.restore();
}

/* --------------------------------------------------------------------------
   PROJECT ARTWORK
   Each returns a drawing confined to the given box.
   -------------------------------------------------------------------------- */

const ARTWORK = {
    /** Dense point cloud sampled on a sphere — the GPU particle engine. */
    particles(ctx, x, y, w, h, tint) {
        const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.44;
        for (let i = 0; i < 2600; i++) {
            const t = Math.acos(1 - 2 * (i + 0.5) / 2600);
            const p = Math.PI * (1 + Math.sqrt(5)) * i;
            const px = Math.sin(t) * Math.cos(p);
            const py = Math.cos(t);
            const pz = Math.sin(t) * Math.sin(p);
            const depth = (pz + 1) / 2;                 // 0 back .. 1 front
            ctx.globalAlpha = 0.15 + depth * 0.75;
            ctx.fillStyle = tint;
            const s = 0.8 + depth * 2.2;
            ctx.fillRect(cx + px * r, cy + py * r, s, s);
        }
        ctx.globalAlpha = 1;
    },

    /** Weighted graph with a highlighted shortest path — route optimiser. */
    graph(ctx, x, y, w, h, tint) {
        const nodes = [];
        const rng = mulberry(7);
        for (let i = 0; i < 13; i++) {
            nodes.push({ x: x + 40 + rng() * (w - 80), y: y + 40 + rng() * (h - 80) });
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(150,170,195,0.28)';
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) > w * 0.42) continue;
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                ctx.stroke();
            }
        }
        // Highlighted route through four of them.
        const path = [0, 4, 8, 12];
        ctx.strokeStyle = tint;
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.shadowColor = tint;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        path.forEach((n, i) => i ? ctx.lineTo(nodes[n].x, nodes[n].y) : ctx.moveTo(nodes[n].x, nodes[n].y));
        ctx.stroke();
        ctx.shadowBlur = 0;
        for (const n of nodes) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#0b1018';
            ctx.fill();
            ctx.strokeStyle = tint;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    },

    /** Conveyor with robot arms — the factory twin. */
    factory(ctx, x, y, w, h, tint) {
        const beltY = y + h * 0.62;
        ctx.fillStyle = 'rgba(140,160,185,0.16)';
        ctx.fillRect(x + 20, beltY, w - 40, 26);
        ctx.strokeStyle = 'rgba(160,180,205,0.45)';
        ctx.lineWidth = 2;
        for (let i = x + 36; i < x + w - 40; i += 34) {
            ctx.beginPath(); ctx.moveTo(i, beltY); ctx.lineTo(i + 14, beltY + 26); ctx.stroke();
        }
        // Parts riding the belt.
        for (let i = 0; i < 4; i++) {
            const px = x + 70 + i * (w - 150) / 3.4;
            ctx.fillStyle = i === 2 ? '#ff5470' : tint;
            roundRect(ctx, px, beltY - 34, 34, 34, 5);
            ctx.fill();
        }
        // Two arms reaching down.
        ctx.strokeStyle = '#f5a524';
        ctx.lineWidth = 11;
        ctx.lineCap = 'round';
        for (const ax of [x + w * 0.3, x + w * 0.68]) {
            ctx.beginPath();
            ctx.moveTo(ax, beltY - 190);
            ctx.lineTo(ax + 46, beltY - 110);
            ctx.lineTo(ax - 10, beltY - 48);
            ctx.stroke();
            ctx.fillStyle = '#2a333f';
            ctx.beginPath(); ctx.arc(ax, beltY - 196, 20, 0, Math.PI * 2); ctx.fill();
        }
        ctx.lineCap = 'butt';
    },

    /** Oscilloscope trace + gauge — the vehicle telemetry bench. */
    telemetry(ctx, x, y, w, h, tint) {
        ctx.strokeStyle = 'rgba(150,170,195,0.16)';
        ctx.lineWidth = 1;
        for (let gx = x; gx < x + w; gx += 46) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
        for (let gy = y; gy < y + h; gy += 46) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }

        ctx.strokeStyle = tint;
        ctx.lineWidth = 4;
        ctx.shadowColor = tint; ctx.shadowBlur = 16;
        ctx.beginPath();
        for (let i = 0; i <= 160; i++) {
            const t = i / 160;
            const px = x + t * w;
            const py = y + h * 0.5 - Math.sin(t * 13) * h * 0.2 * Math.sin(t * 2.6) - Math.sin(t * 41) * 7;
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Dial.
        const cx = x + w * 0.5, cy = y + h * 0.84, r = h * 0.17;
        ctx.strokeStyle = 'rgba(150,170,195,0.3)'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.78, Math.PI * 2.22); ctx.stroke();
        ctx.strokeStyle = tint;
        ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.78, Math.PI * 1.65); ctx.stroke();
    },

    /** Candlesticks — the market dashboard. */
    market(ctx, x, y, w, h, tint) {
        const rng = mulberry(21);
        const n = 22, step = w / n;
        let price = y + h * 0.55;
        for (let i = 0; i < n; i++) {
            const delta = (rng() - 0.48) * h * 0.14;
            const open = price, close = price + delta;
            price = close;
            const up = close < open;
            const cxp = x + i * step + step * 0.5;
            ctx.strokeStyle = up ? '#3ddc97' : '#ff5470';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cxp, Math.min(open, close) - 16);
            ctx.lineTo(cxp, Math.max(open, close) + 16);
            ctx.stroke();
            ctx.fillStyle = up ? '#3ddc97' : '#ff5470';
            const bh = Math.max(6, Math.abs(close - open));
            ctx.fillRect(cxp - step * 0.3, Math.min(open, close), step * 0.6, bh);
        }
        ctx.strokeStyle = tint;
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y + h * 0.5); ctx.lineTo(x + w, y + h * 0.5); ctx.stroke();
        ctx.setLineDash([]);
    },

    /** Meshing gears — the CAD room. */
    gears(ctx, x, y, w, h, tint) {
        const drawGear = (cx, cy, radius, teeth, color) => {
            ctx.beginPath();
            for (let i = 0; i < teeth * 2; i++) {
                const a = (i / (teeth * 2)) * Math.PI * 2;
                const r = i % 2 === 0 ? radius : radius * 0.82;
                const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
                i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
            }
            ctx.closePath();
            ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy, radius * 0.22, 0, Math.PI * 2);
            ctx.stroke();
        };
        const cx = x + w * 0.38, cy = y + h * 0.5;
        drawGear(cx, cy, h * 0.3, 24, tint);
        drawGear(cx + h * 0.46, cy, h * 0.16, 12, 'rgba(180,200,225,0.75)');
    },

    /** Invitation card stack — Lily's Designs. */
    cards(ctx, x, y, w, h, tint) {
        const cw = w * 0.46, ch = h * 0.56;
        for (let i = 2; i >= 0; i--) {
            const ox = x + w * 0.22 + i * 26;
            const oy = y + h * 0.2 + i * 22;
            ctx.save();
            ctx.translate(ox + cw / 2, oy + ch / 2);
            ctx.rotate((i - 1) * 0.07);
            ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
            ctx.fillStyle = i === 0 ? '#fdf6fb' : 'rgba(253,246,251,0.55)';
            roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 10);
            ctx.fill();
            ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            if (i === 0) {
                ctx.strokeStyle = tint; ctx.lineWidth = 2;
                roundRect(ctx, -cw / 2 + 16, -ch / 2 + 16, cw - 32, ch - 32, 6);
                ctx.stroke();
                ctx.fillStyle = tint;
                ctx.font = `28px ${FONTS.display}`;
                ctx.textAlign = 'center';
                ctx.fillText('INVITATION', 0, -14);
                ctx.fillStyle = 'rgba(40,30,45,0.5)';
                ctx.font = `20px ${FONTS.body}`;
                ctx.fillText('— custom printed —', 0, 26);
                ctx.textAlign = 'left';
            }
            ctx.restore();
        }
    },

    /** Flame + receipt — the restaurant ordering system. */
    restaurant(ctx, x, y, w, h, tint) {
        // Flame.
        const fx = x + w * 0.3, fy = y + h * 0.46, fs = h * 0.3;
        const grad = ctx.createLinearGradient(fx, fy + fs, fx, fy - fs);
        grad.addColorStop(0, '#ff3c28');
        grad.addColorStop(0.55, '#ff8a2b');
        grad.addColorStop(1, '#ffd166');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fx, fy - fs);
        ctx.bezierCurveTo(fx + fs * 0.75, fy - fs * 0.2, fx + fs * 0.5, fy + fs * 0.75, fx, fy + fs * 0.8);
        ctx.bezierCurveTo(fx - fs * 0.5, fy + fs * 0.75, fx - fs * 0.75, fy - fs * 0.2, fx, fy - fs);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,240,200,0.85)';
        ctx.beginPath();
        ctx.moveTo(fx, fy - fs * 0.28);
        ctx.bezierCurveTo(fx + fs * 0.34, fy + fs * 0.16, fx + fs * 0.2, fy + fs * 0.62, fx, fy + fs * 0.66);
        ctx.bezierCurveTo(fx - fs * 0.2, fy + fs * 0.62, fx - fs * 0.34, fy + fs * 0.16, fx, fy - fs * 0.28);
        ctx.fill();

        // Order ticket.
        const rw = w * 0.36, rh = h * 0.6;
        const rx = x + w * 0.56, ry = y + h * 0.16;
        ctx.fillStyle = '#f6f1e8';
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = '#2a2320';
        ctx.font = `22px ${FONTS.mono}`;
        ctx.fillText('ORDER #1042', rx + 20, ry + 44);
        ctx.strokeStyle = 'rgba(42,35,32,0.25)';
        ctx.beginPath(); ctx.moveTo(rx + 16, ry + 62); ctx.lineTo(rx + rw - 16, ry + 62); ctx.stroke();
        ctx.font = `19px ${FONTS.mono}`;
        const lines = [['Mixed grill', '2'], ['Shish tawook', '1'], ['Hummus', '3'], ['Fattoush', '1'], ['Mint lemonade', '2']];
        lines.forEach((l, i) => {
            ctx.fillStyle = '#4a4038';
            ctx.fillText(l[0], rx + 20, ry + 100 + i * 34);
            ctx.fillText('x' + l[1], rx + rw - 48, ry + 100 + i * 34);
        });
        ctx.fillStyle = tint;
        ctx.fillRect(rx + 16, ry + rh - 62, rw - 32, 40);
        ctx.fillStyle = '#1a1210';
        ctx.font = `20px ${FONTS.mono}`;
        ctx.fillText('DINE-IN  ·  PAID', rx + 32, ry + rh - 35);
    },

    /** Course modules + progress — the engineering academy. */
    courses(ctx, x, y, w, h, tint) {
        const rows = 4;
        const rh = h * 0.17;
        for (let i = 0; i < rows; i++) {
            const ry = y + h * 0.06 + i * (rh + h * 0.055);
            ctx.fillStyle = 'rgba(255,255,255,0.055)';
            roundRect(ctx, x + 10, ry, w - 20, rh, 12);
            ctx.fill();
            ctx.strokeStyle = 'rgba(180,200,225,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();

            // Module index badge.
            ctx.fillStyle = tint;
            roundRect(ctx, x + 28, ry + rh * 0.24, 46, 46, 10);
            ctx.fill();
            ctx.fillStyle = '#0b1018';
            ctx.font = `600 24px ${FONTS.body}`;
            ctx.textAlign = 'center';
            ctx.fillText(String(i + 1), x + 51, ry + rh * 0.24 + 32);
            ctx.textAlign = 'left';

            // Title bar + progress.
            ctx.fillStyle = 'rgba(230,240,250,0.75)';
            ctx.fillRect(x + 92, ry + rh * 0.3, w * (0.42 - i * 0.05), 11);
            ctx.fillStyle = 'rgba(180,200,225,0.25)';
            ctx.fillRect(x + 92, ry + rh * 0.56, w - 150, 9);
            ctx.fillStyle = tint;
            ctx.fillRect(x + 92, ry + rh * 0.56, (w - 150) * [0.95, 0.72, 0.4, 0.12][i], 9);
        }
    },

    /** Browser windows with live data — the learning platform. */
    platform(ctx, x, y, w, h, tint) {
        const panes = [
            { x: x + 10, y: y + h * 0.06, w: w * 0.62, h: h * 0.5 },
            { x: x + w * 0.32, y: y + h * 0.42, w: w * 0.62, h: h * 0.5 }
        ];
        panes.forEach((p, idx) => {
            ctx.fillStyle = idx ? '#121a26' : '#0d141e';
            ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
            roundRect(ctx, p.x, p.y, p.w, p.h, 12);
            ctx.fill();
            ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.strokeStyle = 'rgba(180,200,225,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();

            // Title bar dots.
            ctx.fillStyle = 'rgba(180,200,225,0.35)';
            for (let d = 0; d < 3; d++) { ctx.beginPath(); ctx.arc(p.x + 24 + d * 18, p.y + 22, 5, 0, Math.PI * 2); ctx.fill(); }

            // Content lines / bars.
            if (idx === 0) {
                for (let r = 0; r < 5; r++) {
                    ctx.fillStyle = r === 1 ? tint : 'rgba(200,215,235,0.3)';
                    ctx.fillRect(p.x + 24, p.y + 56 + r * 26, p.w * (0.7 - r * 0.08), 10);
                }
            } else {
                const bars = [0.45, 0.72, 0.38, 0.9, 0.6, 0.78];
                bars.forEach((b, i) => {
                    ctx.fillStyle = tint;
                    const bw = (p.w - 60) / bars.length - 10;
                    ctx.fillRect(p.x + 30 + i * (bw + 10), p.y + p.h - 24 - b * (p.h - 90), bw, b * (p.h - 90));
                });
            }
        });
    }
};

/** Small deterministic RNG so generated artwork is identical every load. */
function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* --------------------------------------------------------------------------
   PAGE COMPOSITION
   -------------------------------------------------------------------------- */

/**
 * Draws a full project page.
 * @param {object} project
 * @param {number} index 1-based position, printed as a folio number
 */
export function drawProjectPage(project, index) {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    const tint = project.tint;
    const M = 92;                                     // page margin

    // --- paper -----------------------------------------------------------
    const bg = ctx.createLinearGradient(0, 0, PAGE_W, PAGE_H);
    bg.addColorStop(0, '#0e141d');
    bg.addColorStop(1, '#070b12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // Tint wash bleeding from the top edge.
    const wash = ctx.createRadialGradient(PAGE_W * 0.75, -120, 50, PAGE_W * 0.75, -120, PAGE_H * 0.8);
    wash.addColorStop(0, project.tintSoft);
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // --- header ----------------------------------------------------------
    ctx.fillStyle = tint;
    ctx.font = `400 22px ${FONTS.mono}`;
    ctx.fillText(project.category.toUpperCase(), M, M + 26);

    ctx.fillStyle = 'rgba(180,200,225,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(String(index).padStart(2, '0'), PAGE_W - M, M + 26);
    ctx.textAlign = 'left';

    ctx.strokeStyle = 'rgba(180,200,225,0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(M, M + 54); ctx.lineTo(PAGE_W - M, M + 54); ctx.stroke();

    // --- title -----------------------------------------------------------
    ctx.fillStyle = '#f3f7fc';
    ctx.font = `700 ${project.title.length > 18 ? 48 : 58}px ${FONTS.display}`;
    let y = wrapText(ctx, project.title.toUpperCase(), M, M + 140, PAGE_W - M * 2, 72);

    // --- artwork ---------------------------------------------------------
    const artY = y + 24;
    const artH = 470;
    ctx.save();
    roundRect(ctx, M, artY, PAGE_W - M * 2, artH, 16);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    ctx.fillRect(M, artY, PAGE_W - M * 2, artH);
    (ARTWORK[project.art] || ARTWORK.particles)(ctx, M, artY, PAGE_W - M * 2, artH, tint);
    ctx.restore();
    ctx.strokeStyle = 'rgba(180,200,225,0.16)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, M, artY, PAGE_W - M * 2, artH, 16);
    ctx.stroke();

    // --- body copy -------------------------------------------------------
    y = artY + artH + 66;
    ctx.fillStyle = 'rgba(205,218,235,0.92)';
    ctx.font = `400 27px ${FONTS.body}`;
    y = wrapText(ctx, project.blurb, M, y, PAGE_W - M * 2, 42);

    // --- engineering note ------------------------------------------------
    y += 18;
    ctx.fillStyle = tint;
    ctx.fillRect(M, y - 20, 3, 58);
    ctx.fillStyle = 'rgba(170,190,215,0.8)';
    ctx.font = `400 21px ${FONTS.mono}`;
    wrapText(ctx, project.note, M + 22, y, PAGE_W - M * 2 - 22, 30);

    // --- tech chips ------------------------------------------------------
    y += 96;
    ctx.font = `400 19px ${FONTS.mono}`;
    let cx = M;
    for (const tag of project.tags) {
        const tw = ctx.measureText(tag).width + 34;
        if (cx + tw > PAGE_W - M) { cx = M; y += 50; }
        ctx.fillStyle = 'rgba(255,255,255,0.045)';
        roundRect(ctx, cx, y - 26, tw, 40, 20);
        ctx.fill();
        ctx.strokeStyle = 'rgba(180,200,225,0.2)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(205,220,240,0.85)';
        ctx.fillText(tag, cx + 17, y + 1);
        cx += tw + 12;
    }

    // --- status badges ---------------------------------------------------
    const badgeY = PAGE_H - M - 42;
    let bx = M;
    const badge = (label, color, filled) => {
        ctx.font = `400 19px ${FONTS.mono}`;
        const bw = ctx.measureText(label).width + 40;
        ctx.fillStyle = filled ? color : 'rgba(255,255,255,0.04)';
        roundRect(ctx, bx, badgeY, bw, 44, 22);
        ctx.fill();
        if (!filled) { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.fillStyle = filled ? '#06090f' : color;
        ctx.fillText(label, bx + 20, badgeY + 29);
        bx += bw + 12;
    };
    if (project.live) badge('LIVE SITE', '#3ddc97', true);
    if (project.admin) badge('ADMIN DASHBOARD', '#ffa733', false);
    if (!project.live && !project.admin) badge('INTERACTIVE DEMO', tint, false);

    addGrain(ctx, 7);
    return canvas;
}

/** The front cover. */
export function drawCover() {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, PAGE_W, PAGE_H);
    bg.addColorStop(0, '#223243');
    bg.addColorStop(0.5, '#182536');
    bg.addColorStop(1, '#101a28');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // Embossed border.
    ctx.strokeStyle = 'rgba(205,228,255,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(54, 54, PAGE_W - 108, PAGE_H - 108);
    ctx.strokeStyle = 'rgba(205,228,255,0.18)';
    ctx.strokeRect(68, 68, PAGE_W - 136, PAGE_H - 136);

    // Blueprint hairlines.
    ctx.strokeStyle = 'rgba(150,195,250,0.1)';
    ctx.lineWidth = 1;
    for (let i = 120; i < PAGE_H - 120; i += 38) {
        ctx.beginPath(); ctx.moveTo(90, i); ctx.lineTo(PAGE_W - 90, i); ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(160,190,225,0.75)';
    ctx.font = `400 23px ${FONTS.mono}`;
    ctx.fillText('P O R T F O L I O   ·   2 0 2 6', PAGE_W / 2, 250);

    ctx.fillStyle = '#f5f9ff';
    ctx.font = `700 84px ${FONTS.display}`;
    ctx.fillText('MOHAMMAD', PAGE_W / 2, PAGE_H / 2 - 50);
    ctx.fillText('SALEH', PAGE_W / 2, PAGE_H / 2 + 60);

    ctx.strokeStyle = '#4d9fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(PAGE_W / 2 - 90, PAGE_H / 2 + 118);
    ctx.lineTo(PAGE_W / 2 + 90, PAGE_H / 2 + 118);
    ctx.stroke();

    ctx.fillStyle = 'rgba(190,210,235,0.8)';
    ctx.font = `400 28px ${FONTS.body}`;
    ctx.fillText('Systems Engineer', PAGE_W / 2, PAGE_H / 2 + 180);
    ctx.fillText('Full-Stack Developer', PAGE_W / 2, PAGE_H / 2 + 226);

    ctx.fillStyle = 'rgba(150,180,215,0.55)';
    ctx.font = `400 20px ${FONTS.mono}`;
    ctx.fillText('TURN THE PAGE  →', PAGE_W / 2, PAGE_H - 170);

    ctx.textAlign = 'left';
    addGrain(ctx, 8);
    return canvas;
}

/** The closing page: how to get in touch. */
export function drawBackPage() {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 0, PAGE_H);
    bg.addColorStop(0, '#0b121c');
    bg.addColorStop(1, '#06090f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#4d9fff';
    ctx.font = `400 22px ${FONTS.mono}`;
    ctx.fillText('END OF VOLUME', PAGE_W / 2, 230);

    ctx.fillStyle = '#f3f7fc';
    ctx.font = `700 62px ${FONTS.display}`;
    ctx.fillText('LET’S BUILD', PAGE_W / 2, PAGE_H * 0.42);
    ctx.fillText('SOMETHING', PAGE_W / 2, PAGE_H * 0.42 + 84);

    ctx.fillStyle = 'rgba(200,215,235,0.8)';
    ctx.font = `400 27px ${FONTS.body}`;
    wrapTextCentered(ctx, 'Available for engineering roles and selected freelance work.',
        PAGE_W / 2, PAGE_H * 0.42 + 180, PAGE_W - 260, 40);

    ctx.fillStyle = '#ffa733';
    ctx.font = `400 25px ${FONTS.mono}`;
    ctx.fillText('mohalisal1@hotmail.com', PAGE_W / 2, PAGE_H * 0.72);
    ctx.fillStyle = 'rgba(160,185,215,0.7)';
    ctx.fillText('linkedin.com/in/mohammad-saleh-104927373', PAGE_W / 2, PAGE_H * 0.72 + 44);

    ctx.textAlign = 'left';
    addGrain(ctx, 7);
    return canvas;
}

function wrapTextCentered(ctx, text, cx, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, cx, y); y += lineHeight; line = word;
        } else line = test;
    }
    if (line) ctx.fillText(line, cx, y);
}

/** Plain inside-cover paper, used for the sheet backs that carry no project. */
export function drawBlank(label = '') {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0f17';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.strokeStyle = 'rgba(180,200,225,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(60, 60, PAGE_W - 120, PAGE_H - 120);
    if (label) {
        ctx.fillStyle = 'rgba(150,175,205,0.4)';
        ctx.font = `400 22px ${FONTS.mono}`;
        ctx.textAlign = 'center';
        ctx.fillText(label, PAGE_W / 2, PAGE_H / 2);
        ctx.textAlign = 'left';
    }
    addGrain(ctx, 5);
    return canvas;
}
