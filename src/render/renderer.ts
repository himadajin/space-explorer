/* ============================================================
   render — artifact 版の R モジュールの逐語移植。
   命令的モジュールのまま保つ(specs/90-roadmap.md)。React は canvas を
   保持する 1 コンポーネントからこの createRenderer を一度だけ呼ぶ。
   定数・ソルト・式は specs/40-zoom.md / 50-art.md の値のまま。
   ============================================================ */
import * as THREE from "three";
import * as SE from "../core/se";
import type { Descriptor, DustResult, PlanetParams, ProxyParams, Rng, WebKind } from "../core/types";

export interface CandInfo {
  addrStr: string;
  chain: number;
  colorCss: string;
  code: string;
  segIndex: number;
  radius: number;
  fkind: WebKind | null;
  cellDelta: number[];
  pos?: number[];
}
export interface StageDatum {
  desc: Descriptor;
  addrStr: string;
  children: CandInfo[];
  focusedAddrStr?: string | null;
  dust?: DustResult;
}
export type StageData = (StageDatum | null)[];
export interface SkyData {
  chain: number;
  galaxyChain: number;
  hasGalaxy: boolean;
  tint: number[];
  neighbors: CandInfo[];
}
export interface RendererApi {
  buildStages(data: StageData, z0: number): void;
  buildSky(sd: SkyData): void;
  setPickHandler(fn: (pick: CandInfo) => void): void;
  setZoomHandler(fn: (z: number) => void): void;
  setZ(z: number, immediate?: boolean): void;
  getZ(): number;
  setDetail(m: number): void;
  setPixelCap(c: number): void;
  watchPerf(cb: (avgMs: number) => void): void;
  setContextHandler(fn: () => void): void;
  capture(): string | null;
}

interface MatEntry { m: THREE.Material; base: number }
interface PointMatEntry { m: THREE.PointsMaterial; base: number; scenery: boolean }
interface Stage {
  group: THREE.Group;
  mats: MatEntry[];
  pointMats: PointMatEntry[];
  moonPivots: THREE.Group[];
  spin: { obj: THREE.Object3D; rate: number } | null;
  pulse: null;
  // Sprite(system/web)または galaxyPlane の Mesh
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  focusProxy: any;
  fade: number;
}

export function createRenderer(root: HTMLElement): RendererApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200000);

  const sun = new THREE.DirectionalLight(0xfff4e0, 0.95);
  sun.position.set(3.5, 1.6, 2.4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x334466, 0.28);
  fill.position.set(-3, -1, -2);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0x8899bb, 0.3));

  // --- the sky from within ---
  // Standing on a planet, the sky is not decoration: it is the home
  // galaxy seen from inside — thousands of stars concentrated toward
  // the galactic plane, a soft milky band, and a few neighbouring
  // galaxies as barely-there smudges. Synthesized deterministically
  // from the galaxy and system chains, not physically projected, so
  // the same planet always shows the same sky.
  let sky: { group: THREE.Group; mats: MatEntry[] } | null = null;
  function buildSky(sd: SkyData): void {
    if (sky) { scene.remove(sky.group); disposeGroup(sky.group); }
    sky = { group: new THREE.Group(), mats: [] };
    const rng = SE.mulberry32(SE.chain(sd.chain, 0x5C1E));
    const gauss = () => (rng() + rng() + rng() + rng() - 2) / 2;
    const R = 150;
    // the milky band lies along the home galaxy's actual disc plane —
    // the very plane you will see from outside after zooming away
    const n = sd.hasGalaxy ? orientationOf(sd.galaxyChain)
      : new THREE.Vector3(Math.sin(Math.acos(2 * rng() - 1)) * Math.cos(rng() * Math.PI * 2), 0.5, 0.5).normalize();
    const u = new THREE.Vector3(0, 1, 0).cross(n);
    if (u.lengthSq() < 1e-4) u.set(1, 0, 0); else u.normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const tint = sd.tint.map(c => c + (1 - c) * 0.6);
    const PR = renderer.getPixelRatio(); // screen-pixel sizes must scale with DPR

    // two layers: a dense field of faint unresolved stars carries the
    // fullness of a night sky; a few hundred resolved bright stars
    // carry its sharpness
    const dirOf = (bandBias: number) => {
      if (sd.hasGalaxy && rng() < bandBias) {
        const a = rng() * Math.PI * 2;
        const lat = gauss() * 0.13;
        return new THREE.Vector3()
          .addScaledVector(u, Math.cos(lat) * Math.cos(a))
          .addScaledVector(v, Math.cos(lat) * Math.sin(a))
          .addScaledVector(n, Math.sin(lat));
      }
      const t = rng() * Math.PI * 2, p = Math.acos(2 * rng() - 1);
      return new THREE.Vector3(Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t));
    };
    const starLayer = (N: number, bandBias: number, bright: (r: Rng) => number, size: number, opacity: number) => {
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const dir = dirOf(bandBias);
        pos[i * 3] = dir.x * R; pos[i * 3 + 1] = dir.y * R; pos[i * 3 + 2] = dir.z * R;
        const b = bright(rng);
        const t = rng();
        col[i * 3] = b * (0.86 + t * 0.14);
        col[i * 3 + 1] = b * (0.88 + t * 0.08);
        col[i * 3 + 2] = b * (0.92 + (1 - t) * 0.08);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      sky!.group.add(new THREE.Points(g, new THREE.PointsMaterial({ map: pointTexture(),
        size: size, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: opacity, depthWrite: false })));
    };
    const NF = sd.hasGalaxy ? Math.min(60000, Math.round(12000 * Math.pow(detail, 0.78))) : 1400;
    starLayer(NF, 0.62, r => 0.10 + 0.90 * Math.pow(r(), 2.4), 1.15 * PR, 0.8);
    const NB = sd.hasGalaxy ? Math.round(280 * Math.sqrt(detail)) : 70;
    starLayer(NB, 0.5, r => 0.4 + 0.6 * Math.pow(r(), 1.4), 2.3 * PR, 0.95);

    if (sd.hasGalaxy) {
      // the soft glow of the band itself
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rng() * 0.3;
        const sp = glowSprite(tint, 55 + rng() * 35);
        sp.material.opacity = 0.055 + rng() * 0.03;
        sp.position.set(0, 0, 0)
          .addScaledVector(u, Math.cos(a))
          .addScaledVector(v, Math.sin(a))
          .addScaledVector(n, gauss() * 0.05)
          .multiplyScalar(R * 0.98);
        sky.group.add(sp);
      }
    }
    // neighbouring galaxies: barely-there smudges in the night
    for (const nb of sd.neighbors.slice(0, 4)) {
      const r2 = SE.mulberry32(SE.chain(nb.chain, 0x5C1F));
      const t = r2() * Math.PI * 2, p = Math.acos(2 * r2() - 1);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smudgeTexture(desat(nb.colorCss, 0.75)),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.material.rotation = r2() * Math.PI;
      sp.material.opacity = 0.10 + r2() * 0.10;
      const asp = 0.4 + r2() * 0.5; // inclination impression at a glance
      sp.scale.set(6 + r2() * 9, (6 + r2() * 9) * asp, 1);
      sp.position.set(Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)).multiplyScalar(R * 0.97);
      sky.group.add(sp);
    }
    sky.group.traverse(o => {
      const mat = (o as THREE.Sprite).material as THREE.Material | undefined;
      if (mat) { mat.transparent = true; sky!.mats.push({ m: mat, base: mat.opacity }); }
    });
    scene.add(sky.group);
  }
  // the inside view dissolves as you leave the galaxy
  function skyFade(z: number): number {
    return Math.max(0, Math.min(1, 1 - (z - 1.2) / 0.6));
  }

  /* --- procedural textures (visuals only; identity lives in params) --- */
  function makeNoise(rng: Rng, size: number) {
    const g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    const at = (x: number, y: number) => g[((y % size + size) % size) * size + ((x % size + size) % size)];
    function sample(u: number, v: number): number {
      const x = u * size, y = v * size;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    return function fbm(u: number, v: number, oct: number): number {
      let s = 0, amp = 0.5, f = 1;
      for (let o = 0; o < oct; o++) { s += amp * sample(u * f, v * f); amp *= 0.5; f *= 2; }
      return s;
    };
  }
  const css = (c: number[]) => "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
  const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function planetTexture(p: PlanetParams, texSeed: number): THREE.CanvasTexture {
    // still buys resolution: the disc can fill the screen at
    // pixelRatio 3 without going soft
    const W = detail >= 8 ? 1536 : 512, H = W >> 1;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const rng = SE.mulberry32(texSeed);
    const fbm = makeNoise(rng, 64);
    const fbm2 = makeNoise(rng, 64);
    for (let y = 0; y < H; y++) {
      const v = y / H, lat = Math.abs(v - 0.5) * 2;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        // wrap horizontally by sampling on a cylinder-ish pair
        const n = 0.5 * (fbm(u, v * 0.5, 4) + fbm(1 - u, 0.5 + v * 0.5, 4));
        let c: number[];
        if (p.archetype === "gas") {
          const turb = (fbm2(u * 0.7, v, 4) - 0.5) * 0.35;
          const t = 0.5 + 0.5 * Math.sin((v + turb) * Math.PI * 2 * p.bands);
          c = mix(p.base, p.band, t);
          c = mix(c, p.alt, 0.25 + 0.5 * (fbm(u * 2, v * 2, 3) - 0.3));
        } else if (p.archetype === "ice") {
          c = mix(p.base, p.alt, fbm(u * p.noiseScale * 0.4, v * p.noiseScale * 0.4, 4));
          const t = 0.5 + 0.5 * Math.sin(v * Math.PI * 6 + n * 3);
          c = mix(c, p.pole, t * 0.15);
        } else {
          const m = fbm(u * p.noiseScale * 0.5, v * p.noiseScale * 0.5, 5);
          c = mix(p.base, p.alt, Math.min(1, Math.max(0, (m - 0.32) * 2.4)));
          c = mix(c, p.band, Math.max(0, (fbm2(u * 3, v * 3, 3) - 0.62)) * 1.4);
        }
        if (p.poleCap && lat > p.poleCap) {
          c = mix(c, p.pole, Math.min(1, (lat - p.poleCap) / (1 - p.poleCap) * 1.6));
        }
        const i = (y * W + x) * 4;
        img.data[i] = c[0] * 255; img.data[i + 1] = c[1] * 255; img.data[i + 2] = c[2] * 255; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  // grayscale height map re-deriving the same first-noise field the
  // albedo used (same texSeed -> same grid), so bumps match the colors
  function heightTexture(p: PlanetParams, texSeed: number): THREE.CanvasTexture {
    const W = detail >= 8 ? 512 : 256, H = W >> 1;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const rng = SE.mulberry32(texSeed);
    const fbm = makeNoise(rng, 64);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const m = fbm(u * p.noiseScale * 0.5, v * p.noiseScale * 0.5, 5);
        const g = Math.min(255, Math.max(0, m * 255));
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(cv);
  }

  function ringTexture(ring: NonNullable<PlanetParams["ring"]>): THREE.CanvasTexture {
    const W = detail >= 8 ? 1024 : 256;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = 2;
    const ctx = cv.getContext("2d")!;
    const rng = SE.mulberry32(ring.seed);
    for (let x = 0; x < W; x++) {
      const t = x / W;
      let a = Math.sin(t * Math.PI) * ring.alpha;
      a *= 0.55 + 0.45 * Math.sin(t * 40 + rng() * 0.2) * (0.4 + rng() * 0.6);
      a = Math.max(0, a);
      ctx.fillStyle = css(ring.tint);
      ctx.globalAlpha = a;
      ctx.fillRect(x, 0, 1, 2);
    }
    return new THREE.CanvasTexture(cv);
  }

  function glowSprite(color: number[], size: number): THREE.Sprite {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(" + Math.round(color[0] * 255) + "," + Math.round(color[1] * 255) + "," + Math.round(color[2] * 255) + ",0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true }));
    sp.scale.set(size, size, 1);
    return sp;
  }

  const fresnelMat = (color: number[], intensity: number) => new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color[0], color[1], color[2]) }, k: { value: intensity } },
    vertexShader: `
      varying float vF;
      void main(){
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vF = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 3.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 c; uniform float k; varying float vF;
      void main(){ gl_FragColor = vec4(c, vF * k); }`,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.BackSide, depthWrite: false,
  });

  /* --- scale stages --- */
  // Continuous log zoom Z over 5 display stages:
  //   0 planet · 1 system · 2 galaxy · 3 cluster · 4 web
  // Each stage lives in its own unit-sized local frame with the
  // focus-path child anchored at the world origin. Every frame each
  // stage group is scaled by K^(j - Z) and faded by its distance to
  // Z, so crossing scales is a continuous composition of coordinate
  // frames, never a scene swap. The camera never moves in depth.
  const KJ = [400, 1500, 18, 45];
  const LK = KJ.map(Math.log);
  const LSUM = [0, LK[0], LK[0] + LK[1], LK[0] + LK[1] + LK[2], LK[0] + LK[1] + LK[2] + LK[3]];
  function logScaleAt(z: number): number {
    const j = Math.max(0, Math.min(3, Math.floor(z)));
    return LSUM[j] + (z - j) * LK[j];
  }
  let Z = 0, zTarget = 0, zMin = -0.7, zMax = 4.35;
  // detail multiplier: std 1 / high 2 / xhigh 4 / still 8 — display
  // density only, identity is never affected
  let detail = 1;
  function setDetail(m: number): void { detail = m; }
  function setPixelCap(c: number): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, c));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  let stages: (Stage | null)[] = [];
  let pickables: THREE.Object3D[] = [];
  let onPick: ((pick: CandInfo) => void) | null = null;
  let onZoom: ((z: number) => void) | null = null;
  function setPickHandler(fn: (pick: CandInfo) => void): void { onPick = fn; }
  function setZoomHandler(fn: (z: number) => void): void { onZoom = fn; }
  function getZ(): number { return zTarget; }
  // zoom eases toward its target: gestures feel like moving a mass,
  // not flipping a switch
  function setZ(z: number, immediate?: boolean): void {
    zTarget = Math.max(zMin, Math.min(zMax, z));
    if (immediate) Z = zTarget;
    if (onZoom) onZoom(Z);
  }

  // perf watch: measures average frame time shortly after a detail
  // switch so the ui can step back down before the device suffers
  let perfWatch: { skip: number; n: number; sum: number; cb: (avgMs: number) => void } | null = null;
  function watchPerf(cb: (avgMs: number) => void): void { perfWatch = { skip: 25, n: 0, sum: 0, cb }; }
  // context-loss safety net: whatever still asks of the gpu, the
  // worst landing is a rebuild at standard detail
  let onCtxRestored: (() => void) | null = null;
  function setContextHandler(fn: () => void): void { onCtxRestored = fn; }

  // --- light design: every point of light is a sharp 2-3px core
  // with an extremely faint wide halo. Sharp cores carry crispness;
  // vast quiet space carries scale. Colors stay near-achromatic in a
  // narrow ivory-to-pale-blue temperature range.
  const parseRgb = (cssStr: string): number[] => {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(cssStr);
    return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
  };
  // desaturate toward white at display time only — identity params
  // (and therefore fingerprints) are untouched
  const desat = (cssStr: string, t: number): string => {
    const [r, g, b] = parseRgb(cssStr);
    return "rgb(" + Math.round(r + (255 - r) * t) + "," + Math.round(g + (255 - g) * t) + "," + Math.round(b + (255 - b) * t) + ")";
  };
  const withA = (cssStr: string, a: number) => cssStr.replace("rgb(", "rgba(").replace(")", "," + a + ")");

  // every point is a soft round dot — raw square points are banned
  let _pointTex: THREE.CanvasTexture | null = null;
  function pointTexture(): THREE.CanvasTexture {
    if (_pointTex) return _pointTex;
    const cv = document.createElement("canvas"); cv.width = cv.height = 32;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    _pointTex = new THREE.CanvasTexture(cv);
    return _pointTex;
  }

  const markerMatCache = new Map<string, THREE.SpriteMaterial>();
  function markerMaterial(colorCss: string): THREE.SpriteMaterial {
    const hit = markerMatCache.get(colorCss);
    if (hit) return hit;
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const ctx = cv.getContext("2d")!;
    // faint halo
    let g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, withA(colorCss, 0.14));
    g.addColorStop(0.35, withA(colorCss, 0.05));
    g.addColorStop(1, withA(colorCss, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    // sharp core
    g = ctx.createRadialGradient(32, 32, 0, 32, 32, 7);
    g.addColorStop(0, withA(colorCss, 1));
    g.addColorStop(0.5, withA(colorCss, 0.85));
    g.addColorStop(1, withA(colorCss, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    markerMatCache.set(colorCss, m);
    return m;
  }

  // --- shared derivations (parent/child consistency) ---
  // Any visual trait shown at two scales must come from ONE derivation.
  // A galaxy's 3D orientation drives its exterior plane, its interior
  // disc, and the milky band seen from a planet inside it. A system's
  // star color drives both its point in the galaxy and its sun.
  function orientationOf(chainH: number): THREE.Vector3 {
    const r = SE.mulberry32(SE.chain(chainH, 0x0413));
    const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1);
    return new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
  }
  function starColorOf(chainH: number): number[] {
    const r = SE.mulberry32(SE.chain(chainH, 0x57a2));
    return [1, 0.85 + r() * 0.15, 0.65 + r() * 0.3];
  }
  const cssOf = (c: number[]) => "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";

  // a galaxy seen from outside: a circular smudge on a 3D plane
  // tilted by the galaxy's own orientation — the same tilt its
  // interior disc has, so diving in never flips the world
  const smudgeTexCache = new Map<string, THREE.CanvasTexture>();
  function smudgeTexture(tintCss: string): THREE.CanvasTexture {
    const hit = smudgeTexCache.get(tintCss);
    if (hit) return hit;
    const cv = document.createElement("canvas"); cv.width = cv.height = 96;
    const ctx = cv.getContext("2d")!;
    let g = ctx.createRadialGradient(48, 48, 0, 48, 48, 46);
    g.addColorStop(0, withA(tintCss, 0.5));
    g.addColorStop(0.16, withA(tintCss, 0.24));
    g.addColorStop(0.5, withA(tintCss, 0.06));
    g.addColorStop(1, withA(tintCss, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 96);
    g = ctx.createRadialGradient(48, 48, 0, 48, 48, 5);
    g.addColorStop(0, withA(tintCss, 0.95));
    g.addColorStop(1, withA(tintCss, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 96);
    const tex = new THREE.CanvasTexture(cv);
    smudgeTexCache.set(tintCss, tex);
    return tex;
  }
  function galaxyPlane(tintCss: string, chainH: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: smudgeTexture(tintCss),
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending }));
    // plane normal +Z -> galaxy orientation
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), orientationOf(chainH));
    return mesh;
  }

  // near-achromatic feature palette: kinds differ by brightness and
  // form, not by hue — slightly warm nodes, slightly cool filaments
  const WEB_COLOR: Record<WebKind, string> = { node: "rgb(255,241,219)", filament: "rgb(216,229,247)",
    wall: "rgb(182,192,212)", void: "rgb(118,128,152)" };
  const WEB_SIZE: Record<WebKind, number> = { node: 0.075, filament: 0.05, wall: 0.04, void: 0.034 };
  const WEB_ALPHA: Record<WebKind, number> = { node: 0.95, filament: 0.55, wall: 0.32, void: 0.2 };

  function disposeGroup(g: THREE.Object3D): void {
    g.traverse(o => {
      const obj = o as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
        ms.forEach(m => { const mm = m as THREE.Material & { map?: THREE.Texture }; if (mm.map) mm.map.dispose(); mm.dispose(); });
      }
    });
  }
  function newStage(): Stage {
    return { group: new THREE.Group(), mats: [], pointMats: [], moonPivots: [],
      spin: null, pulse: null, focusProxy: null, fade: 1 };
  }
  function collectMats(st: Stage): void {
    st.group.traverse(o => {
      const obj = o as THREE.Points;
      if (obj.material && !Array.isArray(obj.material)) {
        const mat = obj.material as THREE.Material;
        mat.transparent = true;
        st.mats.push({ m: mat, base: mat.opacity === undefined ? 1 : mat.opacity });
        // aggregate point clouds get the point-discipline treatment
        // in updateStageTransforms (size cap + dissolve when entered);
        // scenery clouds are distant objects and scale like bodies
        if ((obj as THREE.Points).isPoints && (mat as THREE.PointsMaterial).sizeAttenuation) {
          const pm = mat as THREE.PointsMaterial;
          st.pointMats.push({ m: pm, base: pm.size, scenery: !!pm.userData.scenery });
        }
      }
    });
  }
  function addPickable(st: Stage, j: number, obj: THREE.Object3D, pick: CandInfo): void {
    obj.userData.pick = pick;
    obj.userData.stage = j;
    pickables.push(obj);
  }
  // deterministic per-candidate scatter, anchored so the focused
  // child sits exactly at the local origin
  function anchorOffset(children: CandInfo[], focusedAddrStr: string | null | undefined,
    posFn: (c: CandInfo) => THREE.Vector3): THREE.Vector3 {
    const f = children.find(c => c.addrStr === focusedAddrStr);
    return f ? posFn(f) : new THREE.Vector3();
  }

  /* --- stage builders (data arrives pre-resolved from the ui layer) --- */
  function buildPlanetStage(d: StageDatum): Stage {
    const st = newStage();
    const p = d.desc.params as PlanetParams;
    const texSeed = parseInt(d.desc.fingerprint, 16);
    const axis = new THREE.Group();
    axis.rotation.z = p.tilt;
    const mat = new THREE.MeshStandardMaterial({
      map: planetTexture(p, texSeed), roughness: 1, metalness: 0 });
    if (p.archetype !== "gas") {
      mat.bumpMap = heightTexture(p, texSeed);
      mat.bumpScale = p.archetype === "rocky" ? 0.03 : 0.015;
    }
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 48, 32), mat);
    axis.add(sphere);
    st.spin = { obj: sphere, rate: p.spin };
    if (p.hasAtmo) {
      axis.add(new THREE.Mesh(new THREE.SphereGeometry(p.radius * 1.045, 48, 32),
        fresnelMat(p.atmo, p.archetype === "gas" ? 0.85 : 0.55)));
    }
    if (p.ring) {
      const inner = p.radius * p.ring.inner, outer = p.radius * p.ring.outer;
      const g = new THREE.RingGeometry(inner, outer, 128, 1);
      const posA = g.attributes.position, uvA = g.attributes.uv;
      for (let i = 0; i < posA.count; i++) {
        const r = Math.hypot(posA.getX(i), posA.getY(i));
        uvA.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        map: ringTexture(p.ring), side: THREE.DoubleSide,
        transparent: true, depthWrite: false }));
      ring.rotation.x = Math.PI / 2;
      axis.add(ring);
    }
    p.moons.forEach((m, i) => {
      const pivot = new THREE.Group();
      pivot.rotation.x = m.incl;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(m.size, 20, 14),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(m.shade, m.shade, m.shade * 1.04), roughness: 1 }));
      mesh.position.x = p.radius * m.dist;
      if (d.children && d.children[i]) addPickable(st, 0, mesh, d.children[i]);
      pivot.add(mesh);
      pivot.userData = { speed: m.speed };
      pivot.rotation.y = m.phase;
      st.group.add(pivot);
      st.moonPivots.push(pivot);
    });
    st.group.add(axis);
    return st;
  }

  // invisible generous hit areas so tiny points stay tappable
  let _hitMat: THREE.SpriteMaterial | null = null;
  function hitMaterial(): THREE.SpriteMaterial {
    if (!_hitMat) _hitMat = new THREE.SpriteMaterial({ opacity: 0, transparent: true, depthWrite: false });
    return _hitMat;
  }

  function buildSystemStage(d: StageDatum): Stage {
    const st = newStage();
    const pos = (c: CandInfo) => {
      const rng = SE.mulberry32(SE.chain(c.chain, 0x0913));
      const orbitR = 0.34 + Math.min(c.segIndex, 12) * 0.17 + rng() * 0.05;
      const ang = rng() * Math.PI * 2;
      return new THREE.Vector3(orbitR * Math.cos(ang), (rng() - 0.5) * 0.05 * orbitR, orbitR * Math.sin(ang));
    };
    const off = anchorOffset(d.children, d.focusedAddrStr, pos);
    // the star: a point of unbearable brightness, not a disc —
    // its color is the same derivation the galaxy stage already shows
    const starC = starColorOf(d.desc.chain);
    const starCss = cssOf(starC);
    const starPos = new THREE.Vector3().copy(off).negate();
    const core = new THREE.Sprite(markerMaterial(starCss).clone());
    core.scale.setScalar(0.06);
    core.position.copy(starPos);
    const halo = glowSprite(starC, 0.5);
    halo.position.copy(starPos);
    const halo2 = glowSprite(starC, 1.7);
    halo2.material.opacity = 0.16;
    halo2.position.copy(starPos);
    st.group.add(core, halo, halo2);
    // planets: near-invisible points of light in the dark, like
    // evening stars — their disc belongs to the planet stage alone
    for (const c of d.children) {
      const p = pos(c).sub(off);
      const sp = new THREE.Sprite(markerMaterial(desat(c.colorCss, 0.3)).clone());
      sp.scale.setScalar(0.013 + c.radius * 0.005);
      sp.position.copy(p);
      st.group.add(sp);
      const hit = new THREE.Sprite(hitMaterial());
      hit.scale.setScalar(0.10);
      hit.position.copy(p);
      addPickable(st, 1, hit, c);
      st.group.add(hit);
      if (c.addrStr === d.focusedAddrStr) st.focusProxy = sp;
    }
    return st;
  }

  // interior stars of a galaxy, in its own local frame. The rng
  // stream is consumed in a fixed order, so asking for N points
  // yields exactly the first N of the full cloud: a distant galaxy
  // is literally a subset of the same stars, resolved sparsely
  function galaxyPointData(chainH: number, colorArr: number[], N: number): { pos: Float32Array; col: Float32Array } {
    const rngB = SE.mulberry32(SE.chain(chainH, 0xB061));
    const gauss = () => (rngB() + rngB() + rngB() + rngB() - 2) / 2;
    const tint = colorArr.map(c => c + (1 - c) * 0.55);
    const posA = new Float32Array(N * 3), colA = new Float32Array(N * 3);
    const cool = [0.78, 0.85, 1.0], warm = [1.0, 0.92, 0.78];
    for (let i = 0; i < N; i++) {
      const u = rngB();
      let x: number, y: number, z: number, w: number, heat: number;
      if (u < 0.24) { // bulge
        const rr = Math.abs(gauss()) * 0.16;
        const th = rngB() * Math.PI * 2, ph = Math.acos(2 * rngB() - 1);
        x = rr * Math.sin(ph) * Math.cos(th); z = rr * Math.sin(ph) * Math.sin(th);
        y = rr * Math.cos(ph) * 0.7;
        w = 0.45 + rngB() * 0.55; heat = 0.9;
      } else if (u < 0.54) { // thin faint disc
        const rr = Math.sqrt(rngB()) * 1.25;
        const th = rngB() * Math.PI * 2;
        x = rr * Math.cos(th); z = rr * Math.sin(th);
        y = gauss() * 0.045 * (1.3 - rr * 0.6);
        w = 0.10 + 0.30 * Math.pow(rngB(), 2); heat = 0.35;
      } else { // arms
        const t = Math.pow(rngB(), 0.75);
        const rr = 0.14 + t * 1.1;
        const arm = (i % 2) * Math.PI;
        const th = arm + Math.log(rr / 0.12) * 2.4 + gauss() * (0.16 + 0.5 * (1 - t));
        const spread = 0.05 + 0.10 * rr;
        x = rr * Math.cos(th) + gauss() * spread;
        z = rr * Math.sin(th) + gauss() * spread;
        y = gauss() * 0.04 * (1.3 - rr * 0.5);
        w = 0.15 + 0.85 * Math.pow(rngB(), 2.4); heat = rngB() < 0.15 ? 0.9 : 0.1;
      }
      posA[i * 3] = x; posA[i * 3 + 1] = y; posA[i * 3 + 2] = z;
      for (let k = 0; k < 3; k++) {
        const base = cool[k] + (warm[k] - cool[k]) * heat;
        colA[i * 3 + k] = (base * 0.65 + tint[k] * 0.35) * w;
      }
    }
    return { pos: posA, col: colA };
  }

  function buildGalaxyStage(d: StageDatum): Stage {
    const st = newStage();
    // the whole galaxy frame is tilted by the galaxy's own
    // orientation — the same one its exterior plane uses
    st.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), orientationOf(d.desc.chain));
    const pos = (c: CandInfo) => {
      const rng = SE.mulberry32(SE.chain(c.chain, 0x6a1a));
      const rr = Math.sqrt(rng()) * 1.2, ang = rng() * Math.PI * 2;
      return new THREE.Vector3(rr * Math.cos(ang), (rng() - 0.5) * 0.08, rr * Math.sin(ang));
    };
    const off = anchorOffset(d.children, d.focusedAddrStr, pos);
    const data = galaxyPointData(d.desc.chain, (d.desc.params as ProxyParams).color, Math.round(2600 * detail));
    for (let i = 0; i < data.pos.length; i += 3) {
      data.pos[i] -= off.x; data.pos[i + 1] -= off.y; data.pos[i + 2] -= off.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(data.col, 3));
    st.group.add(new THREE.Points(g, new THREE.PointsMaterial({ map: pointTexture(),
      size: 0.0065, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending })));
    // still only: a dim spherical halo of old stars around the disc,
    // and small tight star-cluster grains strung along the arms.
    // Separate rng salt, so lower tiers keep their exact clouds.
    if (detail >= 8) {
      const rngX = SE.mulberry32(SE.chain(d.desc.chain, 0xB062));
      const gX = () => (rngX() + rngX() + rngX() + rngX() - 2) / 2;
      const xPos: number[] = [], xCol: number[] = [];
      for (let i = 0; i < 1400; i++) { // halo
        const rr = 0.15 + Math.abs(gX()) * 0.8;
        const th = rngX() * Math.PI * 2, ph = Math.acos(2 * rngX() - 1);
        xPos.push(rr * Math.sin(ph) * Math.cos(th) - off.x,
          rr * Math.cos(ph) * 0.8 - off.y,
          rr * Math.sin(ph) * Math.sin(th) - off.z);
        const w = 0.04 + 0.10 * Math.pow(rngX(), 2);
        xCol.push(w * 0.85, w * 0.9, w);
      }
      for (let c2 = 0; c2 < 26; c2++) { // star clusters on the arms
        const t = Math.pow(rngX(), 0.7);
        const rr = 0.2 + t * 1.0;
        const arm = rngX() < 0.5 ? 0 : Math.PI;
        const th = arm + Math.log(rr / 0.12) * 2.4 + gX() * 0.15;
        const cx = rr * Math.cos(th), cz = rr * Math.sin(th);
        const cy = gX() * 0.03;
        const hot = rngX() < 0.5;
        for (let k = 0; k < 34; k++) {
          xPos.push(cx + gX() * 0.022 - off.x, cy + gX() * 0.014 - off.y, cz + gX() * 0.022 - off.z);
          const w = 0.25 + 0.6 * Math.pow(rngX(), 2);
          if (hot) xCol.push(w * 0.82, w * 0.9, w);
          else xCol.push(w, w * 0.9, w * 0.76);
        }
      }
      const gx = new THREE.BufferGeometry();
      gx.setAttribute("position", new THREE.BufferAttribute(new Float32Array(xPos), 3));
      gx.setAttribute("color", new THREE.BufferAttribute(new Float32Array(xCol), 3));
      st.group.add(new THREE.Points(gx, new THREE.PointsMaterial({ map: pointTexture(),
        size: 0.005, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.9, depthWrite: false,
        blending: THREE.AdditiveBlending })));
    }
    for (const c of d.children) {
      // the point of light IS the star you will meet inside
      const sp = new THREE.Sprite(markerMaterial(cssOf(starColorOf(c.chain))).clone());
      sp.material.opacity = 0.8;
      sp.position.copy(pos(c).sub(off));
      sp.scale.setScalar(0.042);
      st.group.add(sp);
      const hit = new THREE.Sprite(hitMaterial());
      hit.scale.setScalar(0.09);
      hit.position.copy(sp.position);
      addPickable(st, 2, hit, c);
      st.group.add(hit);
      if (c.addrStr === d.focusedAddrStr) st.focusProxy = sp;
    }
    return st;
  }

  function buildClusterStage(d: StageDatum): Stage {
    const st = newStage();
    const pos = (c: CandInfo) => {
      const rng = SE.mulberry32(SE.chain(c.chain, 0xC1a5));
      const v = () => (rng() + rng() + rng()) / 1.5 - 1;
      return new THREE.Vector3(v() * 0.9, v() * 0.5, v() * 0.9);
    };
    const off = anchorOffset(d.children, d.focusedAddrStr, pos);
    // every galaxy is drawn in the same language as the focused one:
    // a subset of its own stars (first N of the same rng stream),
    // merged into one geometry. The smudge plane stays underneath,
    // dimmed, as the unresolved light between the stars.
    const NMINI = Math.round(170 * Math.sqrt(detail));
    const mPos: number[] = [], mCol: number[] = [];
    const q = new THREE.Quaternion(), vv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of d.children) {
      const rng = SE.mulberry32(SE.chain(c.chain, 0xC1a6));
      const op = 0.35 + 0.65 * Math.pow(rng(), 2);
      const size = 0.20 + rng() * 0.18;
      const p0 = pos(c).sub(off);
      const plane = galaxyPlane(desat(c.colorCss, 0.7), c.chain);
      plane.scale.setScalar(size);
      (plane.material as THREE.Material).opacity = op * 0.45;
      plane.position.copy(p0);
      st.group.add(plane);
      const hit = new THREE.Sprite(hitMaterial());
      hit.scale.setScalar(0.13);
      hit.position.copy(p0);
      addPickable(st, 3, hit, c);
      st.group.add(hit);
      if (c.addrStr === d.focusedAddrStr) {
        st.focusProxy = plane;
        continue; // its stars live in the galaxy stage itself
      }
      // baked mini point cloud, oriented and scaled like its interior
      const data = galaxyPointData(c.chain, parseRgb(c.colorCss).map(x => x / 255), NMINI);
      q.setFromUnitVectors(up, orientationOf(c.chain));
      const s = size / 2.6;
      const bright = 0.55 + 0.45 * op;
      for (let i = 0; i < NMINI; i++) {
        vv.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2])
          .applyQuaternion(q).multiplyScalar(s).add(p0);
        mPos.push(vv.x, vv.y, vv.z);
        mCol.push(data.col[i * 3] * bright, data.col[i * 3 + 1] * bright, data.col[i * 3 + 2] * bright);
      }
    }
    if (mPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mPos), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(mCol), 3));
      const mat = new THREE.PointsMaterial({ map: pointTexture(),
        size: 0.005, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.95, depthWrite: false,
        blending: THREE.AdditiveBlending });
      // scenery, not an entered medium: these clumps are distant
      // objects and must scale with their stage frame like any other
      // body, never dissolve under the aggregate rule
      mat.userData.scenery = true;
      st.group.add(new THREE.Points(g, mat));
    }
    return st;
  }

  function buildWebStage(d: StageDatum): Stage {
    const st = newStage();
    // the structure is carried entirely by dust density: matter
    // gathered on walls, filaments and nodes, dim in the voids —
    // no lines, no diagram
    if (d.dust && d.dust.pts.length) {
      const n = d.dust.pts.length / 3;
      const pos = new Float32Array(d.dust.pts);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const w = d.dust.w[i];
        const b = 0.08 + 0.92 * Math.pow(w, 1.6);
        col[i * 3] = b * (0.82 + 0.18 * w);
        col[i * 3 + 1] = b * (0.86 + 0.10 * w);
        col[i * 3 + 2] = b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      st.group.add(new THREE.Points(g, new THREE.PointsMaterial({ map: pointTexture(),
        size: 0.0075, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.9, depthWrite: false,
        blending: THREE.AdditiveBlending })));
      // gas layer: a sparse subset of structure points drawn large
      // and extremely faint — the thickness of the medium
      const gasMax = Math.round(700 * detail);
      const gPos: number[] = [], gCol: number[] = [];
      for (let i = 0, taken = 0; i < n && taken < gasMax; i++) {
        if (d.dust.w[i] < 0.45 || i % 3 !== 0) continue;
        taken++;
        gPos.push(d.dust.pts[i * 3], d.dust.pts[i * 3 + 1], d.dust.pts[i * 3 + 2]);
        const w = d.dust.w[i];
        gCol.push(0.75 + 0.25 * w, 0.8 + 0.12 * w, 0.92);
      }
      if (gPos.length) {
        const gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(gPos), 3));
        gg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(gCol), 3));
        st.group.add(new THREE.Points(gg, new THREE.PointsMaterial({ map: pointTexture(),
          size: 0.13, sizeAttenuation: true, vertexColors: true,
          transparent: true, opacity: 0.045, depthWrite: false,
          blending: THREE.AdditiveBlending })));
      }
    }
    // features at their true geometric positions
    for (const c of d.children) {
      const sp = new THREE.Sprite(markerMaterial(WEB_COLOR[c.fkind!]).clone());
      sp.material.opacity = WEB_ALPHA[c.fkind!];
      sp.position.set(c.pos![0], c.pos![1], c.pos![2]);
      sp.scale.setScalar(WEB_SIZE[c.fkind!]);
      addPickable(st, 4, sp, c);
      st.group.add(sp);
      if (c.addrStr === d.focusedAddrStr) st.focusProxy = sp;
    }
    return st;
  }

  const BUILDERS = [buildPlanetStage, buildSystemStage, buildGalaxyStage,
    buildClusterStage, buildWebStage];

  function buildStages(data: StageData, z0: number): void {
    for (const st of stages) if (st) { scene.remove(st.group); disposeGroup(st.group); }
    stages = new Array(5).fill(null);
    pickables = [];
    let minStage = 4;
    for (let j = 0; j < 5; j++) {
      const d = data[j];
      if (!d) continue;
      minStage = Math.min(minStage, j);
      const st = BUILDERS[j](d);
      collectMats(st);
      scene.add(st.group);
      stages[j] = st;
    }
    zMin = minStage === 0 ? -0.25 : minStage - 0.25;
    // never above the medium: the dark beyond the dust must read
    // as the limit of sight, not the edge of the universe
    zMax = 4.05;
    setZ(z0, true);
    updateStageTransforms();
  }

  // Z -> per-stage scale and crossfade. The main scale owns the
  // frame; neighbouring scales are context and stay at a whisper.
  function stageFade(d: number): number {
    let f: number;
    if (d >= -0.25 && d <= 0.85) f = 1;
    else if (d > 0.85) f = Math.max(0, 1 - (d - 0.85) / 0.85);
    else f = Math.max(0, 1 + (d + 0.25) / 0.65);
    if (d > 0.6) f *= 0.55 + 0.45 * Math.max(0, 1 - (d - 0.6) / 0.4);
    return f;
  }
  function updateStageTransforms(): void {
    if (sky) {
      const f = skyFade(Z);
      sky.group.visible = f > 0.004;
      if (sky.group.visible) for (const mm of sky.mats) mm.m.opacity = mm.base * f;
    }
    for (let j = 0; j < 5; j++) {
      const st = stages[j];
      if (!st) continue;
      const dRel = j - Z;
      const s = Math.exp(LSUM[j] - logScaleAt(Z));
      const fade = stageFade(dRel);
      st.fade = fade;
      st.group.visible = fade > 0.004;
      if (!st.group.visible) continue;
      st.group.scale.setScalar(s);
      for (const mm of st.mats) mm.m.opacity = mm.base * fade;
      // aggregate point clouds are statistical smudges, not objects:
      // they never grow past their native size, and once the camera
      // moves inside them (s >> 1) they dissolve into darkness and
      // hand detail over to the finer stage
      const aggF = s <= 1.5 ? 1 : Math.max(0, 1 - Math.log(s / 1.5) / Math.log(20));
      for (const pm of st.pointMats) {
        if (pm.scenery) {
          // a distant object: scales with its frame, angular size
          // invariant, never dissolves
          pm.m.size = pm.base * s;
        } else {
          pm.m.size = pm.base * Math.min(s, 1);
          pm.m.opacity *= aggF;
        }
      }
      if (st.focusProxy) {
        // true crossfade: the proxy's opacity is exactly the
        // complement of its detail stage's fade, so the focused
        // object never doubles and never pops — one representation
        // hands the light to the other
        const det = stages[j - 1];
        const pv = det ? Math.max(0, Math.min(1, 1 - stageFade((j - 1) - Z))) : 1;
        st.focusProxy.material.opacity *= pv;
        // apparent-size cap: while its stage frame is blown up by
        // the zoom, the proxy stays a small distant light instead of
        // a screen-filling glow; it returns to its native marker
        // size as its own scale arrives (s -> 1)
        const ud = st.focusProxy.userData;
        if (ud.baseScale === undefined) ud.baseScale = st.focusProxy.scale.x;
        st.focusProxy.scale.setScalar(Math.min(ud.baseScale, 0.26 / s));
      }
    }
  }

  /* --- camera & controls --- */
  const orbit = { theta: 0.6, phi: 1.25, dist: 3.6 };
  function applyCamera(): void {
    orbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, orbit.phi));
    const s = Math.sin(orbit.phi);
    camera.position.set(
      orbit.dist * s * Math.cos(orbit.theta),
      orbit.dist * Math.cos(orbit.phi),
      orbit.dist * s * Math.sin(orbit.theta));
    camera.lookAt(0, 0, 0);
  }
  applyCamera();

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchD0 = 0, pinchZ0 = 0;
  let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
  // rotation inertia: releasing a drag lets the sky keep turning,
  // slowing like a heavy globe
  let vTheta = 0, vPhi = 0, lastMoveT = 0;
  const raycaster = new THREE.Raycaster();
  const cnv = renderer.domElement;

  cnv.addEventListener("webglcontextlost", e => { e.preventDefault(); });
  cnv.addEventListener("webglcontextrestored", () => { if (onCtxRestored) onCtxRestored(); });

  function tryPick(x: number, y: number): void {
    if (!onPick || !pickables.length) return;
    const ndc = new THREE.Vector2(
      (x / window.innerWidth) * 2 - 1,
      -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const visible = pickables.filter(o => {
      const st = stages[o.userData.stage];
      return st && st.fade > 0.3 && st.group.visible;
    });
    const hits = raycaster.intersectObjects(visible, false);
    if (hits.length) onPick(hits[0].object.userData.pick);
  }

  cnv.addEventListener("pointerdown", e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vTheta = 0; vPhi = 0; lastMoveT = performance.now();
    if (pointers.size === 1) {
      tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    } else {
      if (tap) tap.moved = true;
      const [a, b] = [...pointers.values()];
      pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
      pinchZ0 = zTarget;
    }
    cnv.setPointerCapture(e.pointerId);
  });
  cnv.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
    if (pointers.size === 1) {
      const dTh = (e.clientX - prev.x) * 0.005;
      const dPh = (e.clientY - prev.y) * 0.005;
      orbit.theta += dTh;
      orbit.phi -= dPh;
      const now = performance.now();
      const dtm = Math.max(8, now - lastMoveT) / 1000;
      lastMoveT = now;
      vTheta = vTheta * 0.65 + (dTh / dtm) * 0.35;
      vPhi = vPhi * 0.65 + (dPh / dtm) * 0.35;
      applyCamera();
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchD0 > 0) {
      const [a, b] = [...pointers.values()];
      const dNow = Math.hypot(a.x - b.x, a.y - b.y);
      // pinch out (fingers apart) zooms in: Z decreases
      setZ(pinchZ0 + Math.log(pinchD0 / Math.max(20, dNow)) / Math.log(2.0));
    }
  });
  const release = (e: PointerEvent) => {
    if (pointers.size === 1 && tap && !tap.moved && performance.now() - tap.t < 400) {
      tryPick(e.clientX, e.clientY);
    }
    pointers.delete(e.pointerId);
    pinchD0 = 0;
    if (pointers.size === 0) tap = null;
  };
  cnv.addEventListener("pointerup", release);
  cnv.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); pinchD0 = 0; tap = null; });
  cnv.addEventListener("wheel", e => {
    e.preventDefault();
    setZ(zTarget + e.deltaY * 0.0016);
  }, { passive: false });
  window.addEventListener("keydown", e => {
    const step = 0.08;
    if (e.key === "ArrowLeft") orbit.theta -= step;
    else if (e.key === "ArrowRight") orbit.theta += step;
    else if (e.key === "ArrowUp") orbit.phi -= step;
    else if (e.key === "ArrowDown") orbit.phi += step;
    else if (e.key === "+" || e.key === "=") { setZ(zTarget - 0.12); return; }
    else if (e.key === "-") { setZ(zTarget + 0.12); return; }
    else return;
    applyCamera();
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  function tick(): void {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1);
    // zoom easing toward its target
    if (Math.abs(zTarget - Z) > 0.0004) {
      Z += (zTarget - Z) * Math.min(1, dt * (reduced ? 30 : 7));
      if (Math.abs(zTarget - Z) <= 0.0004) Z = zTarget;
      if (onZoom) onZoom(Z);
    }
    // rotation inertia after release
    if (!reduced && pointers.size === 0 && (Math.abs(vTheta) + Math.abs(vPhi)) > 0.002) {
      orbit.theta += vTheta * dt;
      orbit.phi -= vPhi * dt;
      const damp = Math.exp(-dt * 3.2);
      vTheta *= damp; vPhi *= damp;
      applyCamera();
    }
    if (!reduced) {
      const st0 = stages[0];
      if (st0) {
        if (st0.spin) st0.spin.obj.rotation.y += st0.spin.rate * dt * 6;
        for (const pv of st0.moonPivots) pv.rotation.y += pv.userData.speed * dt * 4;
      }
    }
    updateStageTransforms();
    renderer.render(scene, camera);
    if (perfWatch) {
      if (perfWatch.skip > 0) perfWatch.skip--;
      else {
        perfWatch.sum += dt; perfWatch.n++;
        if (perfWatch.n >= 90) {
          const cb = perfWatch.cb, avg = perfWatch.sum / perfWatch.n * 1000;
          perfWatch = null;
          cb(avg);
        }
      }
    }
  }
  tick();

  // one-frame high-resolution capture. The buffer is rendered once
  // at up to 4x pixel ratio (bounded to ~4096px on the long side),
  // read out as a PNG data url, then everything is restored.
  // Screen-pixel-sized points (the sky) are compensated so the
  // capture matches what the eye sees, only sharper.
  function capture(): string | null {
    try {
      const w = window.innerWidth, h = window.innerHeight;
      const prev = renderer.getPixelRatio();
      const pr = Math.max(prev, Math.min(4, 4096 / Math.max(w, h)));
      const comp: { m: THREE.PointsMaterial; size: number }[] = [];
      scene.traverse(o => {
        const pts = o as THREE.Points;
        if (pts.isPoints && !(pts.material as THREE.PointsMaterial).sizeAttenuation) {
          const m = pts.material as THREE.PointsMaterial;
          comp.push({ m, size: m.size });
          m.size *= pr / prev;
        }
      });
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL("image/png");
      for (const c of comp) c.m.size = c.size;
      renderer.setPixelRatio(prev);
      renderer.setSize(w, h);
      renderer.render(scene, camera);
      return url;
    } catch {
      return null;
    }
  }

  return { buildStages, buildSky, setPickHandler, setZoomHandler, setZ, getZ,
    setDetail, setPixelCap, watchPerf, setContextHandler, capture };
}
