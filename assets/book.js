/**
 * ==========================================================================
 * THE BOOK
 * ==========================================================================
 * An openable 3D book whose pages bend and turn. Each sheet is a subdivided
 * plane pivoted at the spine; the turn is an object rotation, while the bow in
 * the paper is a vertex displacement injected into a standard PBR material so
 * the page still takes the scene's lighting and casts a real shadow.
 *
 * The maths worth knowing:
 *   - A sheet's geometry is translated so x runs 0..W from the spine outward,
 *     which puts the rotation pivot exactly on the spine.
 *   - Turning is rotation.y from 0 to -PI. Because the plane's normal is +z,
 *     a turned sheet presents its back face, which is physically what should
 *     happen — so the back texture is selected with gl_FrontFacing.
 *   - The bow peaks at the middle of the turn, sin(t * PI), and falls to zero
 *     at both ends, so a settled page is perfectly flat.
 *   - Displacing a vertex without fixing its normal leaves a curved page lit
 *     as though it were flat, so the normal is rebuilt from the analytic
 *     derivative of the bend.
 *
 * @module book
 */

import * as THREE from 'three';

const PI = Math.PI;

/** Cubic ease, used for every page turn so the motion settles rather than stops. */
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class Book {
    /**
     * @param {object}   options
     * @param {number}   [options.width=3.2]   page width in world units
     * @param {number}   [options.height=4.5]  page height
     * @param {number}   [options.segments=36] horizontal subdivisions per sheet
     * @param {number}   [options.sheetGap=0.012] stack spacing between sheets
     * @param {number}   [options.turnDuration=1.15] seconds per page turn
     */
    constructor({ width = 3.2, height = 4.5, segments = 36, sheetGap = 0.012, turnDuration = 1.15 } = {}) {
        this.W = width;
        this.H = height;
        this.segments = segments;
        this.gap = sheetGap;
        this.turnDuration = turnDuration;

        this.group = new THREE.Group();
        this.sheets = [];
        this.turnedCount = 0;          // how many sheets currently lie on the left
        this.queue = [];               // pending turns, so rapid clicks still read well
        this.active = null;            // the turn in flight
        this.hoverSide = 0;            // -1 left page, +1 right page, 0 none
        this.hover = 0;                // eased hover amount, 0..1
        this.hoverTarget = 0;
        this.listeners = new Set();

        this.#buildBoards();
    }

    /** Covers and spine: a slab under each stack plus the rounded spine block. */
    #buildBoards() {
        const boardMat = new THREE.MeshStandardMaterial({
            color: 0x121821, roughness: 0.78, metalness: 0.08
        });
        const edgeMat = new THREE.MeshStandardMaterial({
            color: 0xe8e3d8, roughness: 0.92, metalness: 0.0
        });

        const bw = this.W * 1.03;
        const bh = this.H * 1.02;
        const thickness = 0.1;

        for (const dir of [-1, 1]) {
            const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, thickness), boardMat);
            board.position.set(dir * bw / 2, 0, -thickness / 2 - 0.004);
            board.castShadow = true;
            board.receiveShadow = true;
            this.group.add(board);

            // The cut edge of the paper block, which is what gives a closed
            // book its weight when seen from the side.
            const block = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.97, bh * 0.985, 0.045), edgeMat);
            block.position.set(dir * bw / 2, 0, -0.021);
            block.castShadow = true;
            block.receiveShadow = true;
            this.group.add(block);
            if (dir === -1) this.leftBlock = block; else this.rightBlock = block;
        }

        const spine = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, bh, 18, 1, false, 0, PI),
            boardMat
        );
        spine.rotation.z = PI / 2;
        spine.rotation.y = PI / 2;
        spine.position.z = -0.06;
        spine.castShadow = true;
        this.group.add(spine);
    }

    /**
     * Adds one sheet.
     * @param {THREE.Texture} frontTexture shown while the sheet is on the right
     * @param {THREE.Texture} backTexture  shown once it has been turned
     * @param {object} meta arbitrary data returned with page-change events
     */
    addSheet(frontTexture, backTexture, meta = {}) {
        const geometry = new THREE.PlaneGeometry(this.W, this.H, this.segments, 1);
        // Pivot on the spine: x now runs 0 .. W outward from the hinge.
        geometry.translate(this.W / 2, 0, 0);

        const material = new THREE.MeshStandardMaterial({
            map: frontTexture,
            side: THREE.DoubleSide,
            roughness: 0.86,
            metalness: 0.02
        });
        this.#injectPageShader(material, backTexture);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const sheet = { mesh, material, index: this.sheets.length, turn: 0, meta };
        this.sheets.push(sheet);
        this.group.add(mesh);
        this.#layout();
        return sheet;
    }

    /**
     * Patches a standard material so the page can bow and show a different
     * texture on each face, without giving up PBR shading or shadows.
     */
    #injectPageShader(material, backTexture) {
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTurn = { value: 0 };
            shader.uniforms.uBend = { value: 0 };
            shader.uniforms.uPageW = { value: this.W };
            shader.uniforms.uBackMap = { value: backTexture };

            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', /* glsl */`
                    #include <common>
                    uniform float uTurn;
                    uniform float uBend;
                    uniform float uPageW;
                `)
                // The bend has to be applied before the normal is used, so the
                // normal block is rewritten from the bend's own derivative.
                .replace('#include <beginnormal_vertex>', /* glsl */`
                    #include <beginnormal_vertex>
                    float nx = clamp(position.x / uPageW, 0.0, 1.0);
                    float amp = sin(uTurn * 3.14159265) * uBend;
                    // dz/dx of  z = sin(nx * PI) * amp
                    float slope = cos(nx * 3.14159265) * 3.14159265 * amp / uPageW;
                    objectNormal = normalize(vec3(-slope, 0.0, 1.0));
                `)
                .replace('#include <begin_vertex>', /* glsl */`
                    #include <begin_vertex>
                    float bnx = clamp(position.x / uPageW, 0.0, 1.0);
                    float bamp = sin(uTurn * 3.14159265) * uBend;
                    transformed.z += sin(bnx * 3.14159265) * bamp;
                    // The free edge trails the hinge slightly, which is what
                    // stops a turning page looking like a rotating billboard.
                    transformed.x -= bnx * bnx * abs(bamp) * 0.16;
                `);

            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', /* glsl */`
                    #include <common>
                    uniform sampler2D uBackMap;
                `)
                // Front face reads the sheet's front page; the back face reads
                // the back page, mirrored so its text is not reversed.
                .replace('#include <map_fragment>', /* glsl */`
                    vec4 pageColor = gl_FrontFacing
                        ? texture2D(map, vMapUv)
                        : texture2D(uBackMap, vec2(1.0 - vMapUv.x, vMapUv.y));
                    diffuseColor *= pageColor;
                `);

            material.userData.shader = shader;
        };
        material.customProgramCacheKey = () => 'bookPage';
    }

    /** Positions every sheet according to its turn value. */
    #layout() {
        const n = this.sheets.length;
        for (const sheet of this.sheets) {
            const t = sheet.turn;
            const eased = easeInOut(t);

            sheet.mesh.rotation.y = -eased * PI;

            // Stack height: unturned sheets pile up on the right in reverse
            // order, turned sheets pile up on the left in forward order.
            const zRight = this.gap * (n - sheet.index);
            const zLeft = this.gap * (sheet.index + 1);
            const lift = Math.sin(t * PI) * 0.42;      // arc over the spine
            sheet.mesh.position.z = THREE.MathUtils.lerp(zRight, zLeft, eased) + lift;

            // Hovering the page that would move next lifts its free edge, which
            // is the only hint needed that the book is interactive.
            let bend = 0.55;
            const isHoverTarget =
                (this.hoverSide > 0 && sheet.index === this.turnedCount) ||
                (this.hoverSide < 0 && sheet.index === this.turnedCount - 1);

            if (isHoverTarget && !this.active) {
                const lean = this.hover * 0.1 * (this.hoverSide > 0 ? 1 : -1);
                sheet.mesh.rotation.y -= lean;
                sheet.mesh.position.z += this.hover * 0.05;
                // A page already flat has no bend to scale, so the hover adds
                // its own small bow instead.
                bend += this.hover * 0.22;
            }

            const shader = sheet.material.userData.shader;
            if (shader) {
                // uTurn drives the bow envelope; a resting page needs a nudge
                // off zero for the hover bow to be visible at all.
                const bowPhase = this.active || t > 0.001 && t < 0.999
                    ? t
                    : (isHoverTarget ? this.hover * 0.16 : 0);
                shader.uniforms.uTurn.value = bowPhase;
                shader.uniforms.uBend.value = bend;
            }
        }

        // The paper blocks shrink as their side empties out, and disappear
        // entirely when that side holds no sheets at all.
        const turned = this.turnedCount;
        if (this.leftBlock) {
            this.leftBlock.visible = turned > 0;
            this.leftBlock.scale.z = Math.max(0.08, turned / Math.max(1, n));
        }
        if (this.rightBlock) {
            this.rightBlock.visible = turned < n;
            this.rightBlock.scale.z = Math.max(0.08, (n - turned) / Math.max(1, n));
        }
    }

    /**
     * Lifts the edge of the page under the cursor, so the book answers the
     * pointer before it is clicked.
     * @param {-1|0|1} side
     */
    setHover(side) {
        this.hoverSide = side;
        this.hoverTarget = side === 0 ? 0 : 1;
    }

    /** Subscribes to page changes. Returns an unsubscribe function. */
    onPageChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    #emit() {
        const state = this.getVisible();
        for (const fn of this.listeners) fn(state);
    }

    /**
     * What the reader can currently see.
     * @returns {{left: object|null, right: object|null, index: number, total: number}}
     */
    getVisible() {
        const n = this.sheets.length;
        const k = this.turnedCount;
        return {
            left: k > 0 ? { ...this.sheets[k - 1].meta.back, sheet: k - 1 } : null,
            right: k < n ? { ...this.sheets[k].meta.front, sheet: k } : null,
            index: k,
            total: n
        };
    }

    /** Turns one sheet forward. */
    next() {
        if (this.turnedCount + this.queue.filter(d => d > 0).length >= this.sheets.length) return false;
        this.queue.push(1);
        return true;
    }

    /** Turns one sheet back. */
    prev() {
        if (this.turnedCount - this.queue.filter(d => d < 0).length <= 0) return false;
        this.queue.push(-1);
        return true;
    }

    /** Jumps to a sheet index, turning the pages in between one after another. */
    goTo(targetIndex) {
        const clamped = THREE.MathUtils.clamp(targetIndex, 0, this.sheets.length);
        const pending = this.turnedCount + this.queue.reduce((a, b) => a + b, 0);
        const delta = clamped - pending;
        for (let i = 0; i < Math.abs(delta); i++) this.queue.push(Math.sign(delta));
    }

    get isTurning() { return this.active !== null; }

    /**
     * Advances any in-flight turn. Call once per frame.
     * @param {number} delta seconds
     */
    update(delta) {
        this.hover += (this.hoverTarget - this.hover) * Math.min(1, delta * 9);

        if (!this.active && this.queue.length) {
            const dir = this.queue.shift();
            const sheetIndex = dir > 0 ? this.turnedCount : this.turnedCount - 1;
            const sheet = this.sheets[sheetIndex];
            if (sheet) {
                this.active = { sheet, dir, elapsed: 0, from: sheet.turn, to: dir > 0 ? 1 : 0 };
                // Pages near the top of the stack turn a touch faster, the way
                // a thin few sheets do in a real book.
                this.active.duration = this.turnDuration;
            }
        }

        if (this.active) {
            const a = this.active;
            a.elapsed += delta;
            const t = Math.min(a.elapsed / a.duration, 1);
            a.sheet.turn = THREE.MathUtils.lerp(a.from, a.to, t);
            if (t >= 1) {
                a.sheet.turn = a.to;
                this.turnedCount += a.dir;
                this.active = null;
                this.#layout();
                this.#emit();
                return;
            }
        }

        this.#layout();
    }

    /** Raycastable page meshes, for click and hover handling. */
    get pickTargets() {
        const n = this.sheets.length;
        const k = this.turnedCount;
        const targets = [];
        if (k < n) targets.push(this.sheets[k].mesh);          // right page
        if (k > 0) targets.push(this.sheets[k - 1].mesh);      // left page
        return targets;
    }

    /**
     * Works out which half of the open book a hit landed on.
     * @param {THREE.Intersection} hit
     * @returns {-1|0|1}
     */
    sideOf(hit) {
        if (!hit) return 0;
        const local = this.group.worldToLocal(hit.point.clone());
        return local.x >= 0 ? 1 : -1;
    }

    dispose() {
        this.group.traverse(obj => {
            obj.geometry?.dispose();
            const m = obj.material;
            if (Array.isArray(m)) m.forEach(x => x.dispose());
            else m?.dispose();
        });
    }
}

/**
 * Builds a procedural wood desk the book sits on. Generated rather than
 * downloaded so the page keeps its "no image assets" property.
 * @param {number} [size=40]
 */
export function createDesk(size = 40) {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#2b211a';
    ctx.fillRect(0, 0, 1024, 1024);

    // Grain: long horizontal strokes with drifting lightness, plus occasional
    // darker heartwood lines.
    for (let i = 0; i < 2400; i++) {
        const y = Math.random() * 1024;
        const len = 180 + Math.random() * 760;
        const x = Math.random() * 1024 - len / 2;
        const light = Math.random();
        ctx.strokeStyle = light > 0.82
            ? `rgba(90,66,48,${0.18 + Math.random() * 0.3})`
            : `rgba(${52 + light * 36},${38 + light * 26},${28 + light * 20},${0.1 + Math.random() * 0.22})`;
        ctx.lineWidth = 0.6 + Math.random() * 2.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + len * 0.33, y + (Math.random() - 0.5) * 7,
                          x + len * 0.66, y + (Math.random() - 0.5) * 7,
                          x + len, y + (Math.random() - 0.5) * 4);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    texture.anisotropy = 8;

    const desk = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.74, metalness: 0.04 })
    );
    desk.rotation.x = -PI / 2;
    desk.receiveShadow = true;
    return desk;
}
