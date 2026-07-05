/* ============================================================
   ui/controller — artifact 版の ui IIFE のうち、
   状態・遷移・品質・手帳のロジックを DOM 非依存に移植したもの。
   specs/60-ui-state.md の state を store(snapshot)に写像し、
   React コンポーネント(App.tsx)が購読して DOM を描く。
   ============================================================ */
import * as SE from "../core/se";
import { createRenderer } from "../render/renderer";
import type { CandInfo, RendererApi, SkyData, StageData, StageDatum } from "../render/renderer";
import type { Address, Descriptor, PlanetParams, ProxyParams, WSegment } from "../core/types";

export const DEFAULT_SEED = "7f3e2d";

export interface Bookmark {
  a: string;
  fp: string;
  code: string;
  kind: string;
  colorCss: string;
}
export type PanelId = "jump" | "notebook" | "paste" | "still" | null;

export interface Snapshot {
  booted: boolean;
  seed: string;
  scale: string;
  addrStr: string;
  fp: string;
  verify: { msg: string; ok: boolean } | null;
  canBack: boolean;
  canUp: boolean;
  marked: boolean;
  bookmarks: Bookmark[];
  detailKey: string;
  stillActive: boolean;
  panel: PanelId;
  jumpPrefill: string;
  jumpMsg: string;
  pasteMsg: string;
  toastText: string;
  toastShow: boolean;
  veilOn: boolean;
  veilMsg: string;
}

/* --- store --- */
let snapshot: Snapshot = {
  booted: false,
  seed: "", scale: "", addrStr: "", fp: "",
  verify: null, canBack: false, canUp: false, marked: false,
  bookmarks: [],
  detailKey: "", stillActive: false,
  panel: null, jumpPrefill: "", jumpMsg: "", pasteMsg: "",
  toastText: "", toastShow: false,
  veilOn: false, veilMsg: "",
};
const listeners = new Set<() => void>();
function set(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getSnapshot(): Snapshot {
  return snapshot;
}
// Z 表示は毎フレーム更新されるため、HUD 全体の再描画を避けて別購読にする
const zListeners = new Set<(z: number) => void>();
export function subscribeZ(l: (z: number) => void): () => void {
  zListeners.add(l);
  return () => zListeners.delete(l);
}

/* ==================== state ==================== */
interface ExplorerState {
  addr: Address | null;         // focus target (deepest truth of the path)
  addrStr: string;              // canonical serialized focus address
  anchors: (Address | null)[] | null;
  data: StageData | null;       // per-stage display data
  viewStage: number;            // stage currently in view (follows zoom Z)
  viewAddrStr: string;          // address shown in the HUD
  viewDesc: Descriptor | null;  // its resolved descriptor
  prevAddrStr: string | null;   // one-step back
  bookmarks: Bookmark[];
}
const state: ExplorerState = {
  addr: null, addrStr: "", anchors: null, data: null,
  viewStage: -1, viewAddrStr: "", viewDesc: null,
  prevAddrStr: null, bookmarks: [],
};

let R: RendererApi | null = null;

/* --- toast / veil / clipboard --- */
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toastText: msg, toastShow: true });
  toastTimer = setTimeout(() => set({ toastShow: false }), 1500);
}
function copyText(text: string, doneMsg: string): void {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* noop */ }
    document.body.removeChild(ta);
    showToast(ok ? doneMsg : "Copy failed");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(doneMsg), fallback);
  } else fallback();
}

function descColorCss(desc: Descriptor): string {
  const c = desc.bodyType === "planet" ? (desc.params as PlanetParams).base : (desc.params as ProxyParams).color;
  return "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
}
const codeOf = (kind: string, fp: string) => kind + "-" + fp.slice(0, 4).toUpperCase();

const STAGE_OF_KIND = SE.STAGE_OF_KIND;

/* --- detail quality (display density only, never identity) --- */
// std / high / xhigh cycle on the DETAIL row. still sits apart
// behind its own button + confirmation: a deliberate choice, never
// an accident.
const QUALITIES = [
  { key: "std", mult: 1, px: 2 },
  { key: "high", mult: 2, px: 2 },
  { key: "xhigh", mult: 4, px: 2 },
  { key: "still", mult: 8, px: 3 },
];
let qualityIdx = 0;
let qualityMult = 1;

function candInfo(a: Address, anchorCell?: number[]): CandInfo {
  const d = SE.resolve(a);
  const last = a.segs.length ? a.segs[a.segs.length - 1] : null;
  const info: CandInfo = { addrStr: SE.serializeAddress(a), chain: d.chain,
    colorCss: descColorCss(d), code: codeOf(d.kind, d.fingerprint),
    segIndex: 0, radius: 1, fkind: null, cellDelta: [0, 0, 0] };
  if (last) {
    if (last.k === "W") {
      info.segIndex = last.f.id;
      info.fkind = last.f.kind;
      if (anchorCell) info.cellDelta = [
        last.cell[0] - anchorCell[0], last.cell[1] - anchorCell[1], last.cell[2] - anchorCell[2]];
    } else info.segIndex = last.i;
  }
  if (d.bodyType === "planet") info.radius = (d.params as PlanetParams).radius;
  return info;
}

// stage j shows the children of its anchor; the child lying on the
// focus path is anchored at the origin (out-of-range focus indices
// are appended so they stay visible and anchorable)
function stageData(anchors: (Address | null)[]): StageData {
  const data: StageData = new Array(5).fill(null);
  if (anchors[0]) {
    const desc = SE.resolve(anchors[0]);
    const children = desc.kind === "P"
      ? SE.neighborhood(anchors[0]).children.map(a => candInfo(a)) : [];
    data[0] = { desc, addrStr: SE.serializeAddress(anchors[0]), children };
  }
  for (let j = 1; j <= 3; j++) {
    const anchor = anchors[j];
    if (!anchor) continue;
    const desc = SE.resolve(anchor);
    const children = SE.neighborhood(anchor).children.map(a => candInfo(a));
    let focused = anchors[j - 1];
    if (focused && j === 1 && SE.deepestKind(focused) === "M") {
      focused = SE.parentAddress(focused); // moon focus: anchor its planet
    }
    let focusedAddrStr: string | null = null;
    if (focused) {
      focusedAddrStr = SE.serializeAddress(focused);
      if (!children.some(c => c.addrStr === focusedAddrStr)) children.push(candInfo(focused));
    }
    data[j] = { desc, addrStr: SE.serializeAddress(anchor), children, focusedAddrStr };
  }
  if (anchors[4]) {
    const desc = SE.resolve(anchors[4]);
    const wseg = anchors[4].segs[anchors[4].segs.length - 1] as WSegment;
    const cell = wseg.cell;
    const U = 1.25; // cell units -> stage units
    const focusDet = SE.webFeature(anchors[4].seed, wseg);
    const anchorPos = focusDet.exists ? focusDet.pos!
      : [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5]; // out-of-enumeration fallback
    const rel = (p: number[]) => [(p[0] - anchorPos[0]) * U, (p[1] - anchorPos[1]) * U, (p[2] - anchorPos[2]) * U];
    const focusedAddrStr = SE.serializeAddress(anchors[4]);
    const children: CandInfo[] = [];
    for (const a of [anchors[4], ...SE.neighborhood(anchors[4]).siblings]) {
      const det = SE.webFeature(a.seed, a.segs[a.segs.length - 1] as WSegment);
      const c = candInfo(a);
      if (det.exists) c.pos = rel(det.pos!);
      else if (c.addrStr === focusedAddrStr) c.pos = [0, 0, 0];
      else continue; // out-of-enumeration siblings have no placement
      children.push(c);
    }
    // dust over a ±2 cell box with spherical feathering: the
    // observer sits inside the medium; the dark past the dust is
    // the limit of sight, not an edge
    const FEATHER = [1.4, 2.7];
    const raw = SE.sampleWebDust(anchors[4].seed, cell, 2, 600000 * qualityMult, FEATHER);
    const dustPts: number[] = [], dustW = Array.from(raw.w);
    for (let i = 0; i < raw.pts.length; i += 3) {
      const p = rel([raw.pts[i], raw.pts[i + 1], raw.pts[i + 2]]);
      dustPts.push(p[0], p[1], p[2]);
    }
    // the far annulus (±4 cells): sparse, dim structure past the
    // horizon of reach, so the large-scale web reads as continuing
    // in every direction instead of a thin local shell
    const far = SE.sampleWebDust(anchors[4].seed, cell, 4,
      Math.min(600000, 90000 * qualityMult), [3.2, 4.7], 2.55);
    for (let i = 0; i < far.pts.length; i += 3) {
      const p = rel([far.pts[i], far.pts[i + 1], far.pts[i + 2]]);
      dustPts.push(p[0], p[1], p[2]);
      dustW.push(far.w[i / 3] * 0.55);
    }
    // far hints (high detail and above): nodes in the outer shell
    // baked into the dust as slightly brighter specks — structure
    // continues past reach, without interactive sprites out there
    if (qualityMult >= 2) {
      const rngF = SE.mulberry32(SE.chain(SE.chainHash(anchors[4]), 0xFA96));
      const fw = (p: number[]) => {
        const dx = p[0] - (cell[0] + 0.5), dy = p[1] - (cell[1] + 0.5), dz = p[2] - (cell[2] + 0.5);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return Math.max(0, Math.min(1, 1 - (dist - FEATHER[0]) / (FEATHER[1] - FEATHER[0])));
      };
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++)
          for (let dz = -2; dz <= 2; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== 2) continue;
            const nodes = SE.cellFeatures(anchors[4].seed, [cell[0] + dx, cell[1] + dy, cell[2] + dz]).node;
            for (const nd of nodes) {
              const f = fw(nd.pos);
              if (f <= 0.02) continue;
              for (let k = 0; k < 8; k++) {
                const p = [nd.pos[0] + (rngF() - 0.5) * 0.10,
                  nd.pos[1] + (rngF() - 0.5) * 0.10,
                  nd.pos[2] + (rngF() - 0.5) * 0.10];
                const q = rel(p);
                dustPts.push(q[0], q[1], q[2]);
                dustW.push((0.5 + 0.4 * rngF()) * f);
              }
            }
          }
    }
    data[4] = { desc, addrStr: focusedAddrStr, children, focusedAddrStr,
      dust: { pts: dustPts, w: dustW } };
  }
  return data;
}

/* --- focus --- */
function focusAddress(addr: Address, opts?: { z?: number; noHistory?: boolean }): void {
  opts = opts || {};
  const str = SE.serializeAddress(addr);
  if (state.addrStr && str !== state.addrStr && !opts.noHistory) {
    state.prevAddrStr = state.addrStr;
  }
  state.addr = addr; // focus target: the truth of the path
  state.addrStr = str;
  state.anchors = SE.zoomPath(addr);
  state.data = stageData(state.anchors);
  // the sky seen from inside: derived from the home galaxy and the
  // neighbouring galaxies of its cluster (display only, no identity)
  const gEntry = state.data[2];
  const sysChain = state.data[1] ? state.data[1].desc.chain : SE.chainHash(addr);
  const neighbors = state.data[3]
    ? state.data[3].children.filter(c => !gEntry || c.addrStr !== gEntry.addrStr)
    : [];
  const sky: SkyData = {
    chain: sysChain,
    galaxyChain: gEntry ? gEntry.desc.chain : 0,
    hasGalaxy: !!gEntry,
    tint: gEntry ? (gEntry.desc.params as ProxyParams).color : [0.8, 0.85, 1],
    neighbors,
  };
  R!.buildSky(sky);
  const z = opts.z !== undefined ? opts.z : STAGE_OF_KIND[SE.deepestKind(addr)];
  R!.buildStages(state.data, z);
  syncView(true);
}
function transitionTo(addr: Address, z?: number): void {
  set({ veilOn: true });
  setTimeout(() => {
    focusAddress(addr, { z });
    setTimeout(() => set({ veilOn: false }), 60);
  }, 290);
}

/* --- view follows the main zoom scale --- */
function mainStageFor(z: number): number {
  let best = 0, bd = Infinity;
  for (let j = 0; j < 5; j++) {
    if (!state.data || !state.data[j]) continue;
    const d = Math.abs(j - z);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}
function syncView(force: boolean): void {
  const z = R!.getZ();
  for (const l of zListeners) l(z);
  const m = mainStageFor(z);
  if (!force && m === state.viewStage) return;
  state.viewStage = m;
  const d = state.data![m] as StageDatum;
  state.viewAddrStr = d.addrStr;
  state.viewDesc = d.desc;
  updateHud();
}

function updateHud(): void {
  set({
    booted: true,
    seed: state.addr!.seed,
    scale: state.viewDesc!.kindLabel.toUpperCase(),
    addrStr: state.viewAddrStr,
    fp: state.viewDesc!.fingerprint,
    verify: null,
    canBack: !!state.prevAddrStr,
    canUp: !(state.viewStage >= 4 || !state.data!.slice(state.viewStage + 1).some(d => d)),
    marked: state.bookmarks.some(b => b.a === state.viewAddrStr),
    bookmarks: [...state.bookmarks],
  });
}

/* ==================== exported actions ==================== */

export function copyViewAddress(): void {
  copyText(state.viewAddrStr, "Copied");
}

/* --- verify: cache-independent regeneration check --- */
export function verify(): void {
  const r = SE.parseAddress(state.viewAddrStr); // roundtrip from string
  if (!r.ok) { set({ verify: { msg: "parse failed", ok: false } }); return; }
  const fresh = SE.resolveFresh(r.addr); // bypass cache entirely
  const same = fresh.fingerprint === state.viewDesc!.fingerprint
    && SE.serializeAddress(r.addr) === state.viewAddrStr;
  set({ verify: { msg: same ? "OK · regenerated " + fresh.fingerprint : "MISMATCH " + fresh.fingerprint, ok: same } });
}

/* --- panels --- */
export function closePanels(): void {
  set({ panel: null });
}
export function openJump(): void {
  set({ panel: "jump", jumpMsg: "", jumpPrefill: state.viewAddrStr });
}
export function doJump(value: string): void {
  const r = SE.parseAddress(value);
  if (!r.ok) { set({ jumpMsg: r.error }); return; }
  set({ panel: null });
  if (SE.serializeAddress(r.addr) === state.addrStr) return;
  transitionTo(r.addr);
}

/* --- back --- */
export function back(): void {
  if (!state.prevAddrStr) return;
  const r = SE.parseAddress(state.prevAddrStr);
  if (!r.ok) return;
  state.prevAddrStr = null;
  transitionTo(r.addr);
}

/* --- up --- */
export function up(): void {
  for (let j = state.viewStage + 1; j < 5; j++) {
    if (state.data![j]) { R!.setZ(j); return; }
  }
}

/* --- bookmarks (notebook) --- */
function addBookmark(addrStr: string, desc: Descriptor): boolean {
  if (state.bookmarks.some(b => b.a === addrStr)) return false;
  state.bookmarks.push({
    a: addrStr, fp: desc.fingerprint,
    code: codeOf(desc.kind, desc.fingerprint),
    kind: desc.kindLabel, colorCss: descColorCss(desc),
  });
  return true;
}
export function toggleMark(): void {
  const idx = state.bookmarks.findIndex(b => b.a === state.viewAddrStr);
  if (idx >= 0) {
    state.bookmarks.splice(idx, 1);
    showToast("Removed");
  } else {
    addBookmark(state.viewAddrStr, state.viewDesc!);
    showToast("Marked " + codeOf(state.viewDesc!.kind, state.viewDesc!.fingerprint));
  }
  updateHud();
}
export function toggleNotebook(): void {
  const open = snapshot.panel === "notebook";
  set({ panel: open ? null : "notebook" });
}
export function removeBookmark(a: string): void {
  state.bookmarks = state.bookmarks.filter(x => x.a !== a);
  updateHud();
  showToast("Removed");
}
export function gotoBookmark(a: string): void {
  const r = SE.parseAddress(a);
  if (!r.ok) return;
  set({ panel: null });
  for (let j = 0; j < 5; j++) {
    if (state.data && state.data[j] && state.data[j]!.addrStr === a) { R!.setZ(j); return; }
  }
  transitionTo(r.addr);
}
export function copyAllBookmarks(): void {
  if (!state.bookmarks.length) { showToast("Notebook is empty"); return; }
  copyText(state.bookmarks.map(b => b.a).join("\n"), "Copied " + state.bookmarks.length + " addresses");
}
export function openPaste(): void {
  set({ panel: "paste", pasteMsg: "" });
}
export function cancelPaste(): void {
  set({ panel: "notebook" });
}
export function importPaste(text: string): void {
  const lines = text.split("\n").map(s => s.trim()).filter(s => s.length);
  let added = 0, invalid = 0, dup = 0;
  for (const line of lines) {
    const r = SE.parseAddress(line);
    if (!r.ok) { invalid++; continue; }
    const canon = SE.serializeAddress(r.addr);
    const desc = SE.resolve(r.addr);
    if (addBookmark(canon, desc)) added++; else dup++;
  }
  if (added === 0 && (invalid || dup)) {
    set({ pasteMsg: invalid ? invalid + " invalid" : "already in notebook" });
    return;
  }
  set({ panel: "notebook" });
  updateHud();
  let msg = added + " added";
  if (invalid) msg += " · " + invalid + " invalid";
  showToast(msg);
}

/* --- detail switching --- */
function applyQuality(i: number, rebuild: boolean): void {
  qualityIdx = i;
  qualityMult = QUALITIES[i].mult;
  set({ detailKey: QUALITIES[i].key, stillActive: i === 3 });
  R!.setDetail(QUALITIES[i].mult);
  R!.setPixelCap(QUALITIES[i].px);
  if (rebuild) {
    set({ veilMsg: "rendering", veilOn: true });
    setTimeout(() => {
      focusAddress(state.addr!, { noHistory: true, z: R!.getZ() });
      set({ veilMsg: "" });
      setTimeout(() => set({ veilOn: false }), 60);
      // watch the frame time after heavy switches; step back down
      // before the device suffers
      if (i >= 2) {
        R!.watchPerf(avgMs => {
          if (avgMs > 90 && qualityIdx === i && qualityIdx > 0) {
            applyQuality(qualityIdx - 1, true);
            showToast("Detail lowered · performance");
          }
        });
      }
    }, 290);
  }
}
// the DETAIL button cycles the everyday tiers only; from still it
// returns to std
export function cycleDetail(): void {
  applyQuality(qualityIdx === 3 ? 0 : (qualityIdx + 1) % 3, true);
}

/* --- still: a deliberate choice behind its own confirmation --- */
export function stillButton(): void {
  if (qualityIdx === 3) { applyQuality(0, true); return; } // toggle off
  set({ panel: "still" });
}
export function stillGo(): void {
  set({ panel: null });
  applyQuality(3, true);
}

/* --- capture: one frame, up to 4x resolution, saved as png --- */
export function captureShot(): void {
  set({ panel: null });
  const url = R!.capture();
  if (!url) { showToast("Capture failed"); return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = "space-" + state.viewDesc!.fingerprint + ".png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("Captured");
}

/* ==================== boot ==================== */
let inited = false;
export function init(root: HTMLElement): void {
  if (inited) return;
  inited = true;

  R = createRenderer(root);
  R.setZoomHandler(() => syncView(false));
  R.setPickHandler(c => {
    // tapping something already on the focus path just zooms to it
    for (let j = 0; j < 5; j++) {
      if (state.data![j] && state.data![j]!.addrStr === c.addrStr) { R!.setZ(j); return; }
    }
    const r = SE.parseAddress(c.addrStr);
    if (!r.ok) return;
    showToast("→ " + c.code);
    transitionTo(r.addr, STAGE_OF_KIND[SE.deepestKind(r.addr)]);
  });
  /* --- safety net: whatever happens, land on std --- */
  R.setContextHandler(() => {
    applyQuality(0, true);
    showToast("Detail reset · graphics recovered");
  });

  /* --- boot: the whole web first, then down to a world --- */
  qualityIdx = window.matchMedia && window.matchMedia("(pointer: coarse)").matches ? 0 : 1;
  applyQuality(qualityIdx, false);
  focusAddress(SE.initialAddress(DEFAULT_SEED), { noHistory: true, z: 4 });
}
