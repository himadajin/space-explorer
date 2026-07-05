/* ============================================================
   CORE — pure functions, no DOM / no THREE dependency.
   artifact 版(単一 HTML)の CORE-BEGIN/END 間の逐語移植。
   specs/01-identity.md・02-generation.md・03-cosmic-web.md により
   乱数消費順・分布・32bit 演算を含めてビット単位 [不変]。
   意図的に単一モジュールに保つ(分割は消費順破壊のリスクのみ増やす)。
   ============================================================ */
import type {
  Address, Archetype, CellFeatures, Descriptor, DustResult, Kind, Moon,
  Neighborhood, ParseResult, PlanetParams, ProxyParams, Ring, Rng, Segment,
  WebFeatureDetail, WebFilament, WebKind, WebNode, WebWall, WSegment,
} from "./types";

/* ==================== core/hash ==================== */

export function mix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15; h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}
// splitmix-style chain combine: order-sensitive, deterministic
export function combine(h: number, x: number): number {
  h = (h ^ mix32((x >>> 0) + 0x9e3779b9)) >>> 0;
  return mix32((h + 0x85ebca6b) >>> 0);
}
export function chain(h: number, ...xs: number[]): number {
  for (const x of xs) h = combine(h, x);
  return h;
}
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}
export function mulberry32(a: number): Rng {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hex8 = (h: number): string => (h >>> 0).toString(16).padStart(8, "0");

/* ==================== core/address ==================== */
// Segment order: S -> W -> C -> G -> Y -> P -> M
// Any suffix may be omitted; interior segments may be skipped
// (e.g. a galaxy directly on a filament: S/W/G). Order is fixed.
const SEG_ORDER = ["W", "C", "G", "Y", "P", "M"] as const;
export const WEB_KINDS: WebKind[] = ["void", "wall", "filament", "node"];
export const KIND_LABEL: Record<Kind, string> = {
  S: "seed", W: "web", C: "cluster", G: "galaxy", Y: "system", P: "planet", M: "moon",
};
const TAG: Record<string, number> = {
  S: 0x53, W: 0x57, C: 0x43, G: 0x47, Y: 0x59, P: 0x50, M: 0x4d,
  INIT: 0x1234abcd, LOCAL_NONE: 0x7fffffff,
};
const MAX_INDEX = 1000000;

export function serializeAddress(a: Address): string {
  const parts = ["S" + a.seed];
  for (const s of a.segs) {
    if (s.k === "W") {
      let t = "W:cell=" + s.cell.join(",") + ";f=" + s.f.kind + "," + s.f.id;
      if (s.f.local !== undefined) t += "," + s.f.local;
      parts.push(t);
    } else {
      parts.push(s.k + ":" + s.i);
    }
  }
  return parts.join("/");
}

function fail(error: string): ParseResult { return { ok: false, error }; }
const isInt = (n: number) => Number.isInteger(n);

export function parseAddress(str: string): ParseResult {
  if (typeof str !== "string") return fail("empty");
  const parts = str.trim().split("/").filter(p => p.length > 0);
  if (parts.length === 0) return fail("empty");
  const head = parts[0];
  if (!/^S[A-Za-z0-9\-]{1,32}$/.test(head)) return fail("bad seed segment");
  const addr: Address = { seed: head.slice(1), segs: [] };
  let orderPos = -1;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const k = p[0];
    const pos = (SEG_ORDER as readonly string[]).indexOf(k);
    if (pos < 0) return fail("unknown segment '" + k + "'");
    if (pos <= orderPos) return fail("segment order violated at '" + k + "'");
    orderPos = pos;
    if (k === "W") {
      const body = p.slice(2);
      if (p[1] !== ":") return fail("bad W segment");
      const fields: Record<string, string> = {};
      for (const kv of body.split(";")) {
        const eq = kv.indexOf("=");
        if (eq < 0) return fail("bad W field '" + kv + "'");
        fields[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      if (!fields.cell || !fields.f) return fail("W needs cell and f");
      const cell = fields.cell.split(",").map(Number);
      if (cell.length !== 3 || !cell.every(isInt)) return fail("bad cell coords");
      if (!cell.every(c => Math.abs(c) < MAX_INDEX)) return fail("cell out of range");
      const fp = fields.f.split(",");
      if (fp.length < 2 || fp.length > 3) return fail("bad f field");
      if (!(WEB_KINDS as string[]).includes(fp[0])) return fail("bad web kind '" + fp[0] + "'");
      const id = Number(fp[1]);
      if (!isInt(id) || id < 0 || id >= MAX_INDEX) return fail("bad f id");
      const f: WSegment["f"] = { kind: fp[0] as WebKind, id };
      if (fp.length === 3) {
        const local = Number(fp[2]);
        if (!isInt(local) || local < 0 || local >= MAX_INDEX) return fail("bad f local");
        f.local = local;
      }
      addr.segs.push({ k: "W", cell, f });
    } else {
      const m = /^[CGYPM]:(\d{1,7})$/.exec(p);
      if (!m) return fail("bad segment '" + p + "'");
      const idx = Number(m[1]);
      if (idx >= MAX_INDEX) return fail("index out of range");
      addr.segs.push({ k: k as "C" | "G" | "Y" | "P" | "M", i: idx });
    }
  }
  return { ok: true, addr };
}

export function chainHash(addr: Address): number {
  let h = chain(hashStr(addr.seed), TAG.S);
  for (const s of addr.segs) {
    if (s.k === "W") {
      h = chain(h, TAG.W, s.cell[0], s.cell[1], s.cell[2],
        WEB_KINDS.indexOf(s.f.kind), s.f.id,
        s.f.local === undefined ? TAG.LOCAL_NONE : s.f.local);
    } else {
      h = chain(h, TAG[s.k], s.i);
    }
  }
  return h;
}

export function deepestKind(addr: Address): Kind {
  return addr.segs.length ? addr.segs[addr.segs.length - 1].k : "S";
}

/* ==================== gen ==================== */
const q = (v: number, s = 1000) => Math.round(v * s);

// hue helpers on plain numbers so fingerprints stay DOM/THREE-free
function hsl2rgb(h: number, s: number, l: number): number[] {
  h = ((h % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
const rgbInt = (c: number[]) => (q(c[0], 255) << 16) | (q(c[1], 255) << 8) | q(c[2], 255);

function genPlanet(rng: Rng, isMoon: boolean): PlanetParams {
  const roll = rng();
  const archetype: Archetype = isMoon ? (roll < 0.8 ? "rocky" : "ice")
    : (roll < 0.55 ? "rocky" : roll < 0.80 ? "gas" : "ice");
  const radius = isMoon ? 0.45 + rng() * 0.35
    : archetype === "gas" ? 1.0 + rng() * 0.6
    : 0.55 + rng() * 0.45;
  let hue: number, sat: number, lit: number;
  if (archetype === "rocky") { hue = [0.02, 0.07, 0.10, 0.32, 0.58][Math.floor(rng() * 5)] + rng() * 0.03; sat = 0.25 + rng() * 0.3; lit = 0.34 + rng() * 0.14; }
  else if (archetype === "gas") { hue = [0.06, 0.09, 0.13, 0.48, 0.90][Math.floor(rng() * 5)] + rng() * 0.04; sat = 0.30 + rng() * 0.35; lit = 0.48 + rng() * 0.16; }
  else { hue = 0.50 + rng() * 0.14; sat = 0.12 + rng() * 0.22; lit = 0.62 + rng() * 0.18; }
  const base = hsl2rgb(hue, sat, lit);
  const alt = hsl2rgb(hue + (rng() - 0.5) * 0.09, sat * (0.7 + rng() * 0.5), lit * (0.72 + rng() * 0.3));
  const band = hsl2rgb(hue + (rng() - 0.5) * 0.16, Math.min(1, sat * 1.2), lit * (0.85 + rng() * 0.35));
  const pole = hsl2rgb(hue + 0.02, sat * 0.25, 0.82 + rng() * 0.12);
  const atmo = hsl2rgb(hue + (rng() < 0.5 ? 0.05 : -0.05), 0.5, 0.65);
  const hasAtmo = archetype === "gas" ? true : rng() < 0.6;
  const bands = archetype === "gas" ? 4 + Math.floor(rng() * 7) : 0;
  const noiseScale = 2.5 + rng() * 4;
  const poleCap = archetype !== "gas" && rng() < 0.55 ? 0.72 + rng() * 0.15 : 0;
  const tilt = (rng() - 0.5) * 0.9;
  const spin = 0.03 + rng() * 0.08;
  const ringRoll = rng();
  const ringP = archetype === "gas" ? 0.45 : archetype === "ice" ? 0.15 : 0.05;
  let ring: Ring | null = null;
  if (!isMoon && ringRoll < ringP) {
    ring = {
      inner: 1.35 + rng() * 0.25,
      outer: 1.9 + rng() * 0.7,
      alpha: 0.35 + rng() * 0.35,
      tint: hsl2rgb(hue + (rng() - 0.5) * 0.06, sat * 0.5, 0.6 + rng() * 0.2),
      seed: Math.floor(rng() * 0xffffffff),
    };
  }
  const moonCount = isMoon ? 0
    : Math.floor(rng() * (archetype === "gas" ? 5.6 : 3.4));
  const moons: Moon[] = [];
  for (let i = 0; i < moonCount; i++) {
    moons.push({
      size: 0.05 + rng() * 0.07,
      dist: 2.1 + i * 0.75 + rng() * 0.5,
      speed: (0.10 + rng() * 0.16) * (rng() < 0.12 ? -1 : 1),
      phase: rng() * Math.PI * 2,
      incl: (rng() - 0.5) * 0.4,
      shade: 0.45 + rng() * 0.35,
    });
  }
  return { archetype, radius, base, alt, band, pole, atmo, hasAtmo,
    bands, noiseScale, poleCap, tilt, spin, ring, moons };
}

// Proxy bodies for addresses that stop above planet depth.
function genProxy(rng: Rng, kind: Kind): ProxyParams {
  const hueBase = ({ S: 0.62, W: 0.58, C: 0.75, G: 0.68, Y: 0.12 } as Record<string, number>)[kind];
  const hue = hueBase + (rng() - 0.5) * 0.1;
  const color = hsl2rgb(hue, 0.45 + rng() * 0.3, 0.6 + rng() * 0.2);
  return { color, radius: 0.9, glow: 0.6 + rng() * 0.4, pulse: 0.4 + rng() * 0.6 };
}

function fingerprintPlanet(p: PlanetParams): string {
  let h = 0xC0FFEE11;
  h = chain(h, hashStr(p.archetype), q(p.radius),
    rgbInt(p.base), rgbInt(p.alt), rgbInt(p.band), rgbInt(p.pole), rgbInt(p.atmo),
    p.hasAtmo ? 1 : 0, p.bands, q(p.noiseScale), q(p.poleCap), q(p.tilt), q(p.spin));
  if (p.ring) h = chain(h, 1, q(p.ring.inner), q(p.ring.outer), q(p.ring.alpha), rgbInt(p.ring.tint), p.ring.seed);
  else h = chain(h, 0);
  h = chain(h, p.moons.length);
  for (const m of p.moons) h = chain(h, q(m.size), q(m.dist), q(m.speed), q(m.phase), q(m.incl), q(m.shade));
  return hex8(h);
}
function fingerprintProxy(kind: Kind, p: ProxyParams): string {
  return hex8(chain(0xC0FFEE22, hashStr(kind), rgbInt(p.color), q(p.glow), q(p.pulse)));
}

// A moon's detailed face must agree with the face its parent
// planet already shows: size and shade are inherited from the
// parent's stable moon entry, then the fingerprint is computed
// from the final params (derivation from shared stable params).
function inheritMoonFace(params: PlanetParams, mm: Moon): void {
  params.radius = 0.4 + mm.size * 3.5;
  const g = [mm.shade, mm.shade, mm.shade * 1.04];
  const mixTo = (c: number[], t: number) => c.map((v, k) => v * (1 - t) + g[k] * t);
  params.base = mixTo(params.base, 0.6);
  params.alt = mixTo(params.alt, 0.6);
  params.band = mixTo(params.band, 0.45);
  params.hasAtmo = false;
}

// resolve: address -> stable descriptor (no DOM, no THREE)
export function resolveFresh(addr: Address): Descriptor {
  const h = chainHash(addr);
  const kind = deepestKind(addr);
  const rng = mulberry32(h);
  if (kind === "P" || kind === "M") {
    const params = genPlanet(rng, kind === "M");
    if (kind === "M") {
      const par = parentAddress(addr);
      if (par && deepestKind(par) === "P") {
        const idx = (addr.segs[addr.segs.length - 1] as { i: number }).i;
        const mm = (resolve(par).params as PlanetParams).moons[idx];
        if (mm) inheritMoonFace(params, mm);
      }
    }
    const fingerprint = fingerprintPlanet(params);
    return { kind, kindLabel: KIND_LABEL[kind], bodyType: "planet", params, fingerprint, chain: h };
  }
  const params = genProxy(rng, kind);
  const fingerprint = fingerprintProxy(kind, params);
  return { kind, kindLabel: KIND_LABEL[kind], bodyType: "proxy", params, fingerprint, chain: h };
}

const _cache = new Map<string, Descriptor>();
export function resolve(addr: Address): Descriptor {
  const key = serializeAddress(addr);
  const hit = _cache.get(key);
  if (hit) return hit;
  const d = resolveFresh(addr);
  _cache.set(key, d);
  return d;
}
export function clearCache(): void { _cache.clear(); _webMemo.clear(); }

// deterministic initial focus point for a seed: an ordinary planet
// on a real node of the web, every index within canonical range
export function initialAddress(seed: string): Address {
  const rng = mulberry32(chain(hashStr(seed), TAG.INIT));
  const ri = (n: number) => Math.floor(rng() * n);
  let cell = [ri(49) - 24, ri(49) - 24, ri(49) - 24];
  for (let t = 0; t < 64; t++) {
    if (cellFeatures(seed, cell).node.length) break;
    cell = [ri(49) - 24, ri(49) - 24, ri(49) - 24];
  }
  const nodes = cellFeatures(seed, cell).node;
  let a: Address = { seed, segs: [{ k: "W", cell, f: { kind: "node", id: nodes.length ? ri(nodes.length) : 0 } }] };
  for (const ck of ["C", "G", "Y", "P"] as const) {
    const n = canonicalChildCount(a, ck);
    if (!n) break;
    a = { seed, segs: [...a.segs, { k: ck, i: ri(n) }] };
  }
  return a;
}

/* ---- neighborhood ---- */
// Candidate enumeration uses canonical child counts derived from the
// parent's hash. `jump` intentionally remains unrestricted: any index
// resolves (reachability of unvisited targets), but only canonical
// indices are offered as visible candidates.
const CHILD_KIND: Record<Kind, SegmentKindOrNull> = {
  S: "W", W: "C", C: "G", G: "Y", Y: "P", P: "M", M: null,
};
type SegmentKindOrNull = Segment["k"] | null;
const SALT_COUNT = 0xC41D5;

export function parentAddress(addr: Address): Address | null {
  if (!addr.segs.length) return null;
  return { seed: addr.seed, segs: addr.segs.slice(0, -1) };
}

// Number of canonical children of `parent` having kind `childKind`.
// (childKind is passed explicitly so skip-level addresses like S/W/G
// still enumerate siblings correctly.)
export function canonicalChildCount(parent: Address, childKind: Segment["k"]): number {
  const pk = deepestKind(parent);
  if (childKind === "M" && pk === "P") {
    return (resolve(parent).params as PlanetParams).moons.length; // matches rendered moons
  }
  const rng = mulberry32(chain(chainHash(parent), TAG[childKind], SALT_COUNT));
  switch (childKind) {
    case "C": {
      const wk = pk === "W" ? (parent.segs[parent.segs.length - 1] as WSegment).f.kind : "node";
      if (wk === "node") return 2 + Math.floor(rng() * 4);      // 2..5
      if (wk === "filament") return 1 + Math.floor(rng() * 3);  // 1..3
      if (wk === "wall") return 1 + Math.floor(rng() * 2);      // 1..2
      return Math.floor(rng() * 2);                             // void: 0..1
    }
    case "G": return 8 + Math.floor(rng() * 13);   // 8..20 galaxies
    case "Y": return 10 + Math.floor(rng() * 15);  // 10..24 systems
    case "P": return 3 + Math.floor(rng() * 6);    // 3..8 planets
    case "M": return Math.floor(rng() * 3);        // skip-level moons 0..2
    default: return 0;
  }
}

/* ---- cosmic web: Worley-style approximation ----
   One seed point per grid cell, position from the cell hash.
   Classification of any point by distances F1..F4 to nearby seeds:
   small F2-F1 = wall, small F3-F1 = filament, small F4-F1 = node.
   Voronoi vertices (nodes) are computed explicitly as circumcenters
   of 4 seeds passing a local empty-sphere test; edges (filaments)
   connect vertex pairs sharing 3 parent seeds. Every feature is
   owned by the cell containing its representative point, giving it
   a stable id and therefore a stable address. */
const SALT_SEEDPT = 0x5EED0;
const SALT_DUST = 0xD0570;

export function seedPointOf(seedStr: string, cx: number, cy: number, cz: number): number[] {
  const rng = mulberry32(chain(hashStr(seedStr), SALT_SEEDPT, cx, cy, cz));
  return [cx + rng(), cy + rng(), cz + rng()];
}
interface SeedPt { cell: number[]; pos: number[]; d?: number }
function seedsAround(seedStr: string, cx: number, cy: number, cz: number, r: number): SeedPt[] {
  const out: SeedPt[] = [];
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        const c = [cx + dx, cy + dy, cz + dz];
        out.push({ cell: c, pos: seedPointOf(seedStr, c[0], c[1], c[2]) });
      }
  return out;
}
const d2 = (a: number[], b: number[]) => {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
};

// sorted seed distances at a point; basis of classification & density
export function fDistances(seedStr: string, p: number[]): (SeedPt & { d: number })[] {
  const c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const seeds = seedsAround(seedStr, c[0], c[1], c[2], 1);
  for (const s of seeds) s.d = Math.sqrt(d2(s.pos, p));
  seeds.sort((a, b) => a.d! - b.d!);
  return seeds as (SeedPt & { d: number })[];
}
// density from proximity to wall / filament / node structures;
// tuned dark: deep voids stay nearly empty, matter clings tightly
export function webDensity(seedStr: string, p: number[]): number {
  const s = fDistances(seedStr, p);
  const w = s[1].d - s[0].d, f = s[2].d - s[0].d, n = s[3].d - s[0].d;
  return 0.06 * Math.exp(-(w * w) / 0.014)
    + 0.30 * Math.exp(-(f * f) / 0.006)
    + 1.00 * Math.exp(-(n * n) / 0.0035)
    + 0.004;
}

function circumcenter4(p0: number[], p1: number[], p2: number[], p3: number[]): number[] | null {
  const m: number[][] = [], b: number[] = [];
  for (const p of [p1, p2, p3]) {
    m.push([p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]);
    b.push(0.5 * (d2(p, [0, 0, 0]) - d2(p0, [0, 0, 0])));
  }
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-9) return null;
  const cx = (b[0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (b[1] * m[2][2] - m[1][2] * b[2])
    + m[0][2] * (b[1] * m[2][1] - m[1][1] * b[2])) / det;
  const cy = (m[0][0] * (b[1] * m[2][2] - m[1][2] * b[2])
    - b[0] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * b[2] - b[1] * m[2][0])) / det;
  const cz = (m[0][0] * (m[1][1] * b[2] - b[1] * m[2][1])
    - m[0][1] * (m[1][0] * b[2] - b[1] * m[2][0])
    + b[0] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det;
  return [cx, cy, cz];
}

const qk = (v: number) => Math.round(v * 4096);
const posKey = (p: number[]) => qk(p[0]) + "," + qk(p[1]) + "," + qk(p[2]);
const cellKey = (c: number[]) => c[0] + "," + c[1] + "," + c[2];
const inCell = (p: number[], c: number[]) =>
  Math.floor(p[0]) === c[0] && Math.floor(p[1]) === c[1] && Math.floor(p[2]) === c[2];

// enumeration memo: pure derivation, safe to cache; cleared with
// the resolve cache so verification stays cache-independent
const _webMemo = new Map<string, unknown>();
function memo<T>(key: string, fn: () => T): T {
  if (_webMemo.has(key)) return _webMemo.get(key) as T;
  const v = fn();
  if (_webMemo.size > 4000) _webMemo.clear();
  _webMemo.set(key, v);
  return v;
}

// Voronoi vertices owned by a cell: circumcenters of (own seed +
// 3 of its 10 nearest neighbours) with a locally empty circumsphere
export function cellNodes(seedStr: string, cell: number[]): WebNode[] {
  return memo("n|" + seedStr + "|" + cellKey(cell), () => {
    const all = seedsAround(seedStr, cell[0], cell[1], cell[2], 1);
    const ownKey = cellKey(cell);
    const own = all.find(s => cellKey(s.cell) === ownKey)!;
    const others = all.filter(s => s !== own)
      .sort((a, b) => d2(a.pos, own.pos) - d2(b.pos, own.pos))
      .slice(0, 10);
    const nodes: WebNode[] = [], seen = new Set<string>();
    for (let i = 0; i < others.length; i++)
      for (let j = i + 1; j < others.length; j++)
        for (let k = j + 1; k < others.length; k++) {
          const quad = [own, others[i], others[j], others[k]];
          const cc = circumcenter4(own.pos, others[i].pos, others[j].pos, others[k].pos);
          if (!cc || !inCell(cc, cell)) continue;
          const r2 = d2(cc, own.pos);
          let empty = true;
          for (const s of all) {
            if (quad.includes(s)) continue;
            if (d2(cc, s.pos) < r2 - 1e-9) { empty = false; break; }
          }
          if (!empty) continue;
          const key = posKey(cc);
          if (seen.has(key)) continue;
          seen.add(key);
          nodes.push({ pos: cc, parents: quad.map(s => cellKey(s.cell)).sort() });
        }
    nodes.sort((a, b) => qk(a.pos[0]) - qk(b.pos[0]) || qk(a.pos[1]) - qk(b.pos[1]) || qk(a.pos[2]) - qk(b.pos[2]));
    return nodes;
  });
}

// all features owned by a cell, with stable ids per kind
export function cellFeatures(seedStr: string, cell: number[]): CellFeatures {
  return memo("f|" + seedStr + "|" + cellKey(cell), () => {
    const nodes = cellNodes(seedStr, cell);
    // filaments: pairs of nearby Voronoi vertices sharing 3 parents,
    // owned by the cell containing the edge midpoint
    const nearNodes: WebNode[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          nearNodes.push(...cellNodes(seedStr, [cell[0] + dx, cell[1] + dy, cell[2] + dz]));
    const filaments: WebFilament[] = [], fseen = new Set<string>();
    for (let i = 0; i < nearNodes.length; i++)
      for (let j = i + 1; j < nearNodes.length; j++) {
        const a = nearNodes[i], b = nearNodes[j];
        let shared = 0;
        for (const pk of a.parents) if (b.parents.includes(pk)) shared++;
        if (shared !== 3) continue;
        const mid = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2];
        if (!inCell(mid, cell)) continue;
        const key = posKey(mid);
        if (fseen.has(key)) continue;
        fseen.add(key);
        filaments.push({ pos: mid, a: a.pos, b: b.pos });
      }
    filaments.sort((a, b) => qk(a.pos[0]) - qk(b.pos[0]) || qk(a.pos[1]) - qk(b.pos[1]) || qk(a.pos[2]) - qk(b.pos[2]));
    // walls: seed pairs whose midpoint lies in this cell and whose
    // two nearest seeds are exactly that pair
    const all = seedsAround(seedStr, cell[0], cell[1], cell[2], 1);
    const walls: WebWall[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const mid = [(all[i].pos[0] + all[j].pos[0]) / 2, (all[i].pos[1] + all[j].pos[1]) / 2, (all[i].pos[2] + all[j].pos[2]) / 2];
        if (!inCell(mid, cell)) continue;
        const s = fDistances(seedStr, mid);
        const near2 = [cellKey(s[0].cell), cellKey(s[1].cell)].sort().join("|");
        const pair2 = [cellKey(all[i].cell), cellKey(all[j].cell)].sort().join("|");
        if (near2 !== pair2) continue;
        walls.push({ pos: mid });
      }
    walls.sort((a, b) => qk(a.pos[0]) - qk(b.pos[0]) || qk(a.pos[1]) - qk(b.pos[1]) || qk(a.pos[2]) - qk(b.pos[2]));
    // void: the cell's own seed point, the local density minimum region
    const own = all.find(s => cellKey(s.cell) === cellKey(cell))!;
    return { node: nodes, filament: filaments, wall: walls, void: [{ pos: own.pos.slice() }] };
  });
}

// detail of one addressed feature (position, filament endpoints);
// exists=false for indices outside the current enumeration, which
// still resolve as identities but have no geometric placement
export function webFeature(seedStr: string, wseg: WSegment): WebFeatureDetail {
  const feats = cellFeatures(seedStr, wseg.cell);
  const list: { pos: number[]; a?: number[]; b?: number[] }[] = feats[wseg.f.kind] || [];
  const item = list[wseg.f.id];
  if (!item) return { exists: false };
  return { exists: true, kind: wseg.f.kind, pos: item.pos.slice(),
    a: item.a ? item.a.slice() : null, b: item.b ? item.b.slice() : null };
}

// deterministic dust field: rejection-sampled from the density.
// The seed grid for the whole sampled box is built once up front,
// so hundreds of thousands of attempts stay cheap; this dust IS
// the visible structure of the web. Optional spherical feathering
// (featherR = [r0, r1] in cell units from the cell center) melts
// the data boundary into darkness: the edge of what is drawn reads
// as the limit of sight, never as the edge of the universe.
export function sampleWebDust(seedStr: string, cell: number[], r: number, attempts: number,
  featherR?: number[] | null, minR?: number): DustResult {
  const rng = mulberry32(chain(hashStr(seedStr), SALT_DUST, cell[0], cell[1], cell[2]));
  const span = 2 * r + 1;
  const cx = cell[0] + 0.5, cy = cell[1] + 0.5, cz = cell[2] + 0.5;
  // precompute seeds for the box plus a 1-cell margin
  const R = r + 1, side = 2 * R + 1;
  const grid: number[][] = new Array(side * side * side);
  for (let dx = -R; dx <= R; dx++)
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++) {
        grid[(dx + R) + (dy + R) * side + (dz + R) * side * side] =
          seedPointOf(seedStr, cell[0] + dx, cell[1] + dy, cell[2] + dz);
      }
  const pts: number[] = [], w: number[] = [];
  for (let t = 0; t < attempts; t++) {
    const p = [cell[0] - r + rng() * span, cell[1] - r + rng() * span, cell[2] - r + rng() * span];
    let fw = 1;
    if (featherR || minR) {
      const rx = p[0] - cx, ry = p[1] - cy, rz = p[2] - cz;
      const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (minR && dist < minR) continue; // annulus sampling
      if (featherR) {
        fw = Math.max(0, Math.min(1, 1 - (dist - featherR[0]) / (featherR[1] - featherR[0])));
        if (fw <= 0) continue;
      }
    }
    const gx = Math.floor(p[0]) - cell[0], gy = Math.floor(p[1]) - cell[1], gz = Math.floor(p[2]) - cell[2];
    // four smallest squared distances among the 27 surrounding seeds
    let f1 = 1e9, f2 = 1e9, f3 = 1e9, f4 = 1e9;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const s = grid[(gx + dx + R) + (gy + dy + R) * side + (gz + dz + R) * side * side];
          const ex = s[0] - p[0], ey = s[1] - p[1], ez = s[2] - p[2];
          const dd = ex * ex + ey * ey + ez * ez;
          if (dd < f1) { f4 = f3; f3 = f2; f2 = f1; f1 = dd; }
          else if (dd < f2) { f4 = f3; f3 = f2; f2 = dd; }
          else if (dd < f3) { f4 = f3; f3 = dd; }
          else if (dd < f4) { f4 = dd; }
        }
    const s1 = Math.sqrt(f1);
    const wv = Math.sqrt(f2) - s1, fv = Math.sqrt(f3) - s1, nv = Math.sqrt(f4) - s1;
    const dens = 0.06 * Math.exp(-(wv * wv) / 0.014)
      + 0.30 * Math.exp(-(fv * fv) / 0.006)
      + 1.00 * Math.exp(-(nv * nv) / 0.0035)
      + 0.004;
    if (rng() < dens * fw) {
      pts.push(p[0], p[1], p[2]);
      w.push(Math.min(1, dens) * (0.35 + 0.65 * fw));
    }
  }
  return { pts, w };
}

// features in a cell and its 26 neighbours, as address objects
// (order: cells lexicographic, then kind, then id — deterministic)
function webFeaturesAround(seed: string, cell: number[]): Address[] {
  const out: Address[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = [cell[0] + dx, cell[1] + dy, cell[2] + dz];
        const feats = cellFeatures(seed, c);
        for (const kind of WEB_KINDS) {
          for (let id = 0; id < feats[kind].length; id++) {
            out.push({ seed, segs: [{ k: "W", cell: c, f: { kind, id } }] });
          }
        }
      }
  return out;
}

export function neighborhood(addr: Address): Neighborhood {
  const kind = deepestKind(addr);
  const self = serializeAddress(addr);
  const parent = parentAddress(addr);
  const siblings: Address[] = [], children: Address[] = [];

  if (kind === "S") {
    // root: offer the web features of the origin cell as children
    for (const a of webFeaturesAround(addr.seed, [0, 0, 0])) children.push(a);
  } else if (kind === "W") {
    const cell = (addr.segs[addr.segs.length - 1] as WSegment).cell;
    for (const a of webFeaturesAround(addr.seed, cell)) {
      if (serializeAddress(a) !== self) siblings.push(a);
    }
    const n = canonicalChildCount(addr, "C");
    for (let i = 0; i < n; i++) children.push({ seed: addr.seed, segs: [...addr.segs, { k: "C", i }] });
  } else {
    const prefix = addr.segs.slice(0, -1);
    const n = canonicalChildCount(parent!, kind as Segment["k"]);
    for (let i = 0; i < n; i++) {
      const a: Address = { seed: addr.seed, segs: [...prefix, { k: kind as Exclude<Segment["k"], "W">, i }] };
      if (serializeAddress(a) !== self) siblings.push(a);
    }
    const ck = CHILD_KIND[kind];
    if (ck) {
      const m = canonicalChildCount(addr, ck);
      for (let i = 0; i < m; i++) children.push({ seed: addr.seed, segs: [...addr.segs, { k: ck as Exclude<Segment["k"], "W">, i }] });
    }
  }
  return { parent, siblings, children };
}

/* ---- zoom path ---- */
// Display-stage anchors: 0 planet · 1 system · 2 galaxy · 3 cluster · 4 web.
// Real ancestors come from the focus address; below the focus a
// deterministic representative descent (child index = parent hash
// mod canonical count) fills the remaining stages, so zooming in is
// always meaningful and always lands on the same objects.
export const STAGE_OF_KIND: Record<Kind, number> = { P: 0, M: 0, Y: 1, G: 2, C: 3, W: 4, S: 4 };
const DESCEND_KIND: Partial<Record<Kind, Exclude<Segment["k"], "W">>> = { W: "C", C: "G", G: "Y", Y: "P" };
export function zoomPath(focusAddr: Address): (Address | null)[] {
  const anchors: (Address | null)[] = new Array(5).fill(null);
  let cum: Address = { seed: focusAddr.seed, segs: [] };
  for (const seg of focusAddr.segs) {
    cum = { seed: cum.seed, segs: [...cum.segs, seg] };
    anchors[STAGE_OF_KIND[seg.k]] = cum;
  }
  let cur = focusAddr;
  while (true) {
    const k = deepestKind(cur);
    if (STAGE_OF_KIND[k] === 0) break;
    let next: Address | null = null;
    if (k === "S") {
      const feats = neighborhood(cur).children;
      if (!feats.length) break;
      next = feats[chainHash(cur) % feats.length];
    } else {
      const ck = DESCEND_KIND[k]!;
      const n = canonicalChildCount(cur, ck);
      if (!n) break; // e.g. an empty void: zoom stops at this stage
      next = { seed: cur.seed, segs: [...cur.segs, { k: ck, i: chainHash(cur) % n }] };
    }
    const ns = STAGE_OF_KIND[deepestKind(next)];
    if (!anchors[ns]) anchors[ns] = next;
    cur = next;
  }
  return anchors;
}
