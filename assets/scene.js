/**
 * ==========================================================================
 * SHARED WEBGL STAGE
 * ==========================================================================
 * Every 3D view in this portfolio is built on the same renderer setup, so the
 * scenes share one lighting model, one colour pipeline and one render loop.
 *
 * What this module takes care of, once, for all of them:
 *   - Correct colour management (sRGB output + ACES filmic tone mapping), so
 *     metals and emissive surfaces read the way they were authored instead of
 *     washing out.
 *   - Image-based lighting from a generated room probe, which is what makes
 *     rough/metallic materials look like real objects rather than flat shapes.
 *   - A device-pixel-ratio cap, because rendering 9x the pixels on a phone
 *     buys nothing visible and costs the frame budget.
 *   - Rendering only while the canvas is actually on screen and the tab is
 *     visible, so a background tab stops burning battery.
 *   - ResizeObserver-driven sizing, which tracks the container rather than the
 *     window, so panels and split layouts stay sharp.
 *   - A single delta-timed loop, so motion runs at the same speed on a 60Hz
 *     and a 144Hz display.
 *
 * @module scene
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Thrown when the browser cannot give us a WebGL context at all. */
export class WebGLUnavailableError extends Error {
    constructor(cause) {
        super('WebGL is not available in this browser');
        this.name = 'WebGLUnavailableError';
        this.cause = cause;
    }
}

/** Feature probe used before we commit to building a scene. */
export function supportsWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return Boolean(
            window.WebGL2RenderingContext && canvas.getContext('webgl2') ||
            window.WebGLRenderingContext && canvas.getContext('webgl')
        );
    } catch {
        return false;
    }
}

export class Stage {
    /**
     * @param {HTMLElement} container element the canvas fills
     * @param {object}      [options]
     * @param {number}      [options.fov=45]
     * @param {number}      [options.near=0.1]
     * @param {number}      [options.far=500]
     * @param {boolean}     [options.shadows=true]
     * @param {boolean}     [options.environment=true] generate the IBL probe
     * @param {number}      [options.exposure=1]
     * @param {number|null} [options.background=null] scene clear colour
     * @param {boolean}     [options.controls=true]
     */
    constructor(container, options = {}) {
        if (!container) throw new Error('Stage requires a container element');
        if (!supportsWebGL()) throw new WebGLUnavailableError();

        const {
            fov = 45, near = 0.1, far = 500,
            shadows = true, environment = true, exposure = 1,
            background = null, controls = true
        } = options;

        this.container = container;
        this.clock = new THREE.Clock();
        this.updaters = new Set();
        this.isRunning = false;
        this.isVisible = true;

        try {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: background === null,
                powerPreference: 'high-performance'
            });
        } catch (err) {
            throw new WebGLUnavailableError(err);
        }

        // Colour pipeline. Without these two lines everything renders flat and
        // over-bright, which is the single most common reason hobby WebGL
        // scenes look unfinished.
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = exposure;

        if (shadows) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        if (background !== null) this.scene.background = new THREE.Color(background);

        this.camera = new THREE.PerspectiveCamera(fov, 1, near, far);
        this.camera.position.set(0, 4, 12);

        if (controls) {
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.06;
            this.controls.enablePan = false;
        }

        if (environment) this.#buildEnvironment();

        this.#observeSize();
        this.#observeVisibility();
        this.resize();
    }

    /**
     * Generates a small room probe and uses it as the scene environment. This
     * is what gives metallic surfaces something to reflect; with no
     * environment, `metalness: 1` renders as a black object.
     */
    #buildEnvironment() {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environment = this.environmentTexture;
        // Keep the reflections subtle so authored colours stay dominant.
        this.scene.environmentIntensity = 0.35;
        pmrem.dispose();
    }

    /**
     * Adds a three-point rig: a key light that casts shadows, a cool fill to
     * stop the shadow side going black, and a rim light to separate the
     * subject from the background.
     * @param {object} [options]
     */
    addStudioLights({ key = 2.4, fill = 0.55, rim = 1.6, keyColor = 0xffffff, fillColor = 0x88b4ff, rimColor = 0xffd9a0, shadowArea = 18 } = {}) {
        const ambient = new THREE.AmbientLight(0xffffff, 0.25);
        this.scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(keyColor, key);
        keyLight.position.set(6, 10, 7);
        if (this.renderer.shadowMap.enabled) {
            keyLight.castShadow = true;
            keyLight.shadow.mapSize.set(2048, 2048);
            keyLight.shadow.bias = -0.0008;
            keyLight.shadow.normalBias = 0.02;
            const cam = keyLight.shadow.camera;
            cam.near = 0.5; cam.far = 60;
            cam.left = -shadowArea; cam.right = shadowArea;
            cam.top = shadowArea; cam.bottom = -shadowArea;
            cam.updateProjectionMatrix();
        }
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(fillColor, fill);
        fillLight.position.set(-8, 4, -2);
        this.scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(rimColor, rim);
        rimLight.position.set(-3, 6, -9);
        this.scene.add(rimLight);

        this.lights = { ambient, key: keyLight, fill: fillLight, rim: rimLight };
        return this.lights;
    }

    /**
     * Places the camera so `object` fits the viewport on BOTH axes. A tall,
     * narrow panel has a far tighter horizontal field of view than vertical, so
     * solving only for the vertical angle crops the subject sideways.
     * @param {THREE.Object3D} object
     * @param {object} [options]
     * @param {number} [options.padding=1.2] headroom multiplier
     * @param {THREE.Vector3} [options.direction] view direction from the centre
     * @param {boolean} [options.keepOnResize=true] re-frame when the box changes
     */
    frameObject(object, { padding = 1.2, direction, keepOnResize = true } = {}) {
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;
        const sphere = box.getBoundingSphere(new THREE.Sphere());

        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
        const distance = Math.max(
            sphere.radius / Math.sin(vFov / 2),
            sphere.radius / Math.sin(hFov / 2)
        ) * padding;

        const dir = (direction || this.framing?.direction || new THREE.Vector3(1, 0.62, 1)).clone().normalize();
        this.camera.position.copy(sphere.center).add(dir.multiplyScalar(distance));
        this.camera.updateProjectionMatrix();
        if (this.controls) {
            this.controls.target.copy(sphere.center);
            this.controls.update();
        }

        // Remember the request so a container resize can re-fit automatically.
        this.framing = keepOnResize
            ? { object, padding, direction: (direction || new THREE.Vector3(1, 0.62, 1)).clone() }
            : null;
        return distance;
    }

    /** Registers a per-frame callback. Returns an unsubscribe function. */
    onFrame(fn) {
        this.updaters.add(fn);
        return () => this.updaters.delete(fn);
    }

    /** Matches drawing-buffer size and camera aspect to the container box. */
    resize() {
        const { clientWidth: w, clientHeight: h } = this.container;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);

        if (this.framing) {
            const box = new THREE.Box3().setFromObject(this.framing.object);
            if (!box.isEmpty()) {
                const sphere = box.getBoundingSphere(new THREE.Sphere());
                const vFov = THREE.MathUtils.degToRad(this.camera.fov);
                const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
                const distance = Math.max(
                    sphere.radius / Math.sin(vFov / 2),
                    sphere.radius / Math.sin(hFov / 2)
                ) * this.framing.padding;
                // Preserve the current orbit direction; only correct the distance.
                const dir = this.camera.position.clone().sub(sphere.center).normalize();
                this.camera.position.copy(sphere.center).add(dir.multiplyScalar(distance));
                this.camera.updateProjectionMatrix();
            }
        }

        this.render();
    }

    #observeSize() {
        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.container);
        } else {
            this.onWindowResize = () => this.resize();
            window.addEventListener('resize', this.onWindowResize);
        }
    }

    /** Pauses the loop when the canvas scrolls away or the tab is hidden. */
    #observeVisibility() {
        if ('IntersectionObserver' in window) {
            this.intersectionObserver = new IntersectionObserver(
                ([entry]) => { this.isVisible = entry.isIntersecting; },
                { threshold: 0 }
            );
            this.intersectionObserver.observe(this.container);
        }
        this.onVisibilityChange = () => {
            // getDelta() is reset on wake so a long pause cannot produce one
            // enormous frame step that teleports every animation.
            if (!document.hidden) this.clock.getDelta();
        };
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.clock.getDelta();
        this.renderer.setAnimationLoop(() => this.#tick());
    }

    stop() {
        this.isRunning = false;
        this.renderer.setAnimationLoop(null);
    }

    #tick() {
        if (document.hidden || !this.isVisible) return;
        // Clamped so a stalled frame cannot jump the simulation forward.
        const delta = Math.min(this.clock.getDelta(), 0.1);
        const elapsed = this.clock.elapsedTime;
        if (this.controls) this.controls.update();
        for (const update of this.updaters) update(delta, elapsed);
        this.render();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    /** Releases GPU memory and detaches every observer and listener. */
    dispose() {
        this.stop();
        this.resizeObserver?.disconnect();
        this.intersectionObserver?.disconnect();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
        this.controls?.dispose();
        this.environmentTexture?.dispose();
        this.scene.traverse(obj => {
            obj.geometry?.dispose();
            const material = obj.material;
            if (Array.isArray(material)) material.forEach(m => m.dispose());
            else material?.dispose();
        });
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

/**
 * Renders a readable message in place of a scene that could not start, so a
 * WebGL failure never leaves a silent empty rectangle on the page.
 */
export function renderSceneFallback(container, message = 'This view needs WebGL, which this browser could not provide.') {
    if (!container) return;
    container.innerHTML = '';
    const box = document.createElement('div');
    box.setAttribute('role', 'note');
    box.style.cssText = `
        display:flex; flex-direction:column; gap:10px; align-items:center; justify-content:center;
        height:100%; min-height:220px; padding:24px; text-align:center;
        font-family:var(--font-mono, monospace); font-size:12px; line-height:1.9;
        color:var(--text-muted, #6b7a90);`;
    const title = document.createElement('strong');
    title.textContent = '3D VIEW UNAVAILABLE';
    title.style.cssText = 'letter-spacing:.18em; color:var(--text-body, #b6c2d4);';
    const detail = document.createElement('span');
    detail.textContent = message;
    box.append(title, detail);
    container.appendChild(box);
}
