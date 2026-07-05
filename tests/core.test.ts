/* specs/07-verification.md の回帰テスト項目と既知の正解値。
   contracts/porting-invariants.md §1・§2 の恒久ゲート。 */
import { beforeEach, describe, expect, it } from "vitest";
import * as SE from "../src/core/se";
import type { Address, PlanetParams, WSegment } from "../src/core/types";

const SEED = "7f3e2d";
const KNOWN_INITIAL = "S7f3e2d/W:cell=14,-17,16;f=node,0/C:2/G:5/Y:15/P:1";
const KNOWN_FP = "ef3eeabe";
const COMPAT_ADDR = "S7f3e2d/W:cell=14,-17,16;f=node,1/C:3/G:37/Y:21/P:3";
const COMPAT_FP = "0136482c";

function parse(s: string): Address {
  const r = SE.parseAddress(s);
  if (!r.ok) throw new Error("parse failed: " + s + " (" + r.error + ")");
  return r.addr;
}

beforeEach(() => SE.clearCache());

describe("既知の正解値 [不変]", () => {
  it("initialAddress(7f3e2d) と fingerprint", () => {
    const a = SE.initialAddress(SEED);
    expect(SE.serializeAddress(a)).toBe(KNOWN_INITIAL);
    const d = SE.resolveFresh(a);
    expect(d.fingerprint).toBe(KNOWN_FP);
    expect(d.bodyType).toBe("planet");
    expect((d.params as PlanetParams).archetype).toBe("gas");
  });
  it("旧列挙互換 address: identity は有効、配置は無い", () => {
    const a = parse(COMPAT_ADDR);
    expect(SE.resolveFresh(a).fingerprint).toBe(COMPAT_FP);
    const w = a.segs[0] as WSegment;
    expect(SE.webFeature(SEED, w).exists).toBe(false);
  });
});

describe("identity / address", () => {
  const ROUNDTRIP = [
    "S7f3e2d",
    "S7f3e2d/W:cell=14,-17,16;f=node,0",
    "S7f3e2d/W:cell=14,-17,16;f=node,0/C:2/G:5/Y:15/P:1/M:0",
    "S7f3e2d/W:cell=1,-2,3;f=filament,1,4",
    "S7f3e2d/W:cell=-5,-7,-9;f=wall,2",
    "S7f3e2d/G:5",
    "S7f3e2d/W:cell=0,0,0;f=void,0/G:3",
    "S7f3e2d/M:2",
    "SA-1/W:cell=2,3,4;f=node,1/C:0",
  ];
  it("serialize(parse(s)) 往復一致", () => {
    for (const s of ROUNDTRIP) {
      expect(SE.serializeAddress(parse(s))).toBe(s);
    }
  });
  it("不正入力の拒否", () => {
    const BAD = [
      "",
      "X7f3e2d",
      "S",
      "S7f3e2d/G:1/C:2",              // 順序違反
      "S7f3e2d/C:1/C:2",              // 重複
      "S7f3e2d/C:1000000",            // 範囲外 index
      "S7f3e2d/X:1",                  // 未知種別
      "S7f3e2d/W:cell=1,2;f=node,0",  // cell 不足
      "S7f3e2d/W:cell=1,2,3;f=blob,0",// 未知 web kind
      "S7f3e2d/W:cell=1,2,3",         // f 欠落
      "S7f3e2d/W:cell=1000000,0,0;f=node,0", // cell 範囲外
      "S!!!/C:1",                     // 不正 seed
      "S7f3e2d/P:-1",
    ];
    for (const s of BAD) {
      expect(SE.parseAddress(s).ok, s).toBe(false);
    }
  });
  it("resolveFresh の決定性とキャッシュ非依存", () => {
    const a = parse(KNOWN_INITIAL);
    const f1 = SE.resolveFresh(a).fingerprint;
    const f2 = SE.resolveFresh(a).fingerprint;
    expect(f2).toBe(f1);
    const cached = SE.resolve(a).fingerprint;
    SE.clearCache();
    expect(SE.resolve(a).fingerprint).toBe(cached);
    expect(SE.resolveFresh(a).fingerprint).toBe(cached);
  });
  it("兄弟 512 件で fingerprint 衝突ゼロ", () => {
    const base = parse("S7f3e2d/W:cell=14,-17,16;f=node,0/C:2");
    const fps = new Set<string>();
    for (let g = 0; g < 8; g++)
      for (let y = 0; y < 8; y++)
        for (let p = 0; p < 8; p++) {
          const a: Address = { seed: SEED, segs: [...base.segs, { k: "G", i: g }, { k: "Y", i: y }, { k: "P", i: p }] };
          fps.add(SE.resolveFresh(a).fingerprint);
        }
    expect(fps.size).toBe(512);
  });
  it("異なる seed で初期 fingerprint が分岐", () => {
    const f1 = SE.resolveFresh(SE.initialAddress("7f3e2d")).fingerprint;
    const f2 = SE.resolveFresh(SE.initialAddress("abc")).fingerprint;
    expect(f1).not.toBe(f2);
  });
});

describe("neighborhood / zoomPath", () => {
  const signature = (addr: Address) => {
    const n = SE.neighborhood(addr);
    return [...n.siblings, ...n.children]
      .map(a => SE.serializeAddress(a) + ":" + SE.resolve(a).fingerprint)
      .join("|");
  };
  it("候補集合の署名が clearCache 前後で一致", () => {
    const a = parse(KNOWN_INITIAL);
    const s1 = signature(a);
    SE.clearCache();
    expect(signature(a)).toBe(s1);
  });
  it("惑星の子候補数 = moons.length、兄弟数 = 正規個数 − 1", () => {
    const a = parse(KNOWN_INITIAL);
    const d = SE.resolve(a);
    const n = SE.neighborhood(a);
    expect(n.children.length).toBe((d.params as PlanetParams).moons.length);
    const parent = SE.parentAddress(a)!;
    expect(n.siblings.length).toBe(SE.canonicalChildCount(parent, "P") - 1);
  });
  it("範囲外 focus(P:999)では正規候補が全件列挙される", () => {
    const parent = SE.parentAddress(parse(KNOWN_INITIAL))!;
    const out: Address = { seed: SEED, segs: [...parent.segs, { k: "P", i: 999 }] };
    const n = SE.neighborhood(out);
    expect(n.siblings.length).toBe(SE.canonicalChildCount(parent, "P"));
    expect(SE.resolveFresh(out).fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
  it("スキップ階層の兄弟列挙が (親, 自 kind) の正規個数に従う", () => {
    const a = parse("S7f3e2d/G:5");
    const root: Address = { seed: SEED, segs: [] };
    const n = SE.neighborhood(a);
    expect(n.siblings.length).toBe(SE.canonicalChildCount(root, "G") - 1);
  });
  it("zoomPath: 惑星 focus で 5 anchor 充填、各実祖先 anchor は接頭辞", () => {
    const a = parse(KNOWN_INITIAL);
    const anchors = SE.zoomPath(a);
    expect(anchors.every(x => x !== null)).toBe(true);
    const full = SE.serializeAddress(a);
    for (const anc of anchors) {
      expect(full.startsWith(SE.serializeAddress(anc!))).toBe(true);
    }
  });
  it("zoomPath: 銀河 focus の代表降下が正規範囲内で再現", () => {
    const g = parse("S7f3e2d/W:cell=14,-17,16;f=node,0/C:2/G:5");
    const a1 = SE.zoomPath(g).map(x => (x ? SE.serializeAddress(x) : null));
    SE.clearCache();
    const a2 = SE.zoomPath(g).map(x => (x ? SE.serializeAddress(x) : null));
    expect(a2).toEqual(a1);
    // 降下した Y/P の index が正規範囲内
    const y = SE.zoomPath(g)[1]!;
    const p = SE.zoomPath(g)[0]!;
    const yi = (y.segs[y.segs.length - 1] as { i: number }).i;
    const pi = (p.segs[p.segs.length - 1] as { i: number }).i;
    expect(yi).toBeLessThan(SE.canonicalChildCount(g, "Y"));
    expect(pi).toBeLessThan(SE.canonicalChildCount(y, "P"));
  });
  it("zoomPath: スキップ階層で該当ステージが null", () => {
    const a = parse("S7f3e2d/W:cell=14,-17,16;f=node,0/G:3");
    const anchors = SE.zoomPath(a);
    expect(anchors[3]).toBeNull(); // C ステージが欠ける
    expect(anchors[4]).not.toBeNull();
    expect(anchors[2]).not.toBeNull();
  });
  it("zoomPath: 衛星 focus で stage0 = 衛星自身", () => {
    const m = parse(KNOWN_INITIAL + "/M:0");
    const anchors = SE.zoomPath(m);
    expect(SE.serializeAddress(anchors[0]!)).toBe(SE.serializeAddress(m));
  });
  it("zoomPath: 子個数 0(空のボイド)で降下が停止", () => {
    // C 数 0 のボイドを探す(void の C は 0..1)
    let found: Address | null = null;
    outer: for (let x = 0; x < 6; x++)
      for (let y = 0; y < 6; y++)
        for (let z = 0; z < 6; z++) {
          const a: Address = { seed: SEED, segs: [{ k: "W", cell: [x, y, z], f: { kind: "void", id: 0 } }] };
          if (SE.canonicalChildCount(a, "C") === 0) { found = a; break outer; }
        }
    expect(found).not.toBeNull();
    const anchors = SE.zoomPath(found!);
    expect(anchors[4]).not.toBeNull();
    expect(anchors[3]).toBeNull();
    expect(anchors[0]).toBeNull();
  });
  it("zoomPath: ルート(S のみ)からの降下が安定", () => {
    const root: Address = { seed: SEED, segs: [] };
    const a1 = SE.zoomPath(root).map(x => (x ? SE.serializeAddress(x) : null));
    SE.clearCache();
    const a2 = SE.zoomPath(root).map(x => (x ? SE.serializeAddress(x) : null));
    expect(a2).toEqual(a1);
    expect(a1[4]).not.toBeNull();
  });
});

describe("cosmic web", () => {
  const CELL = [14, -17, 16];
  it("全ノードが所有・4 親等距離・空球条件を満たす(±2 セル)", () => {
    let count = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++) {
          const cell = [CELL[0] + dx, CELL[1] + dy, CELL[2] + dz];
          for (const nd of SE.cellNodes(SEED, cell)) {
            count++;
            // 所有セル内包
            expect(Math.floor(nd.pos[0])).toBe(cell[0]);
            expect(Math.floor(nd.pos[1])).toBe(cell[1]);
            expect(Math.floor(nd.pos[2])).toBe(cell[2]);
            // 4 親種点への等距離 & 空球条件(F1..F4 = 外接球半径)
            const s = SE.fDistances(SEED, nd.pos);
            const r = s[0].d;
            for (let i = 0; i < 4; i++) {
              expect(Math.abs(s[i].d - r)).toBeLessThan(1e-6);
            }
            const parentKeys = new Set(nd.parents);
            for (let i = 0; i < 4; i++) {
              expect(parentKeys.has(s[i].cell.join(","))).toBe(true);
            }
          }
        }
    expect(count).toBeGreaterThan(100); // 期待規模: 125 セルで 200 前後
  });
  it("cellFeatures の署名が clearCache 前後で一致、フィラメントは両端を持つ", () => {
    const sig1 = JSON.stringify(SE.cellFeatures(SEED, CELL));
    SE.clearCache();
    expect(JSON.stringify(SE.cellFeatures(SEED, CELL))).toBe(sig1);
    for (const f of SE.cellFeatures(SEED, CELL).filament) {
      expect(f.a).toHaveLength(3);
      expect(f.b).toHaveLength(3);
    }
  });
  it("feature address が一意で往復可能、列挙された全兄弟が exists", () => {
    const w: Address = { seed: SEED, segs: [{ k: "W", cell: CELL, f: { kind: "node", id: 0 } }] };
    const n = SE.neighborhood(w);
    const seen = new Set<string>();
    for (const a of [w, ...n.siblings]) {
      const s = SE.serializeAddress(a);
      expect(seen.has(s)).toBe(false);
      seen.add(s);
      const r = SE.parseAddress(s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(SE.serializeAddress(r.addr)).toBe(s);
      expect(SE.webFeature(SEED, a.segs[0] as WSegment).exists).toBe(true);
    }
  });
  it("密度: ノード位置 ≫ ボイド位置(比 50 以上)", () => {
    const nd = SE.cellNodes(SEED, CELL)[0];
    const vd = SE.cellFeatures(SEED, CELL).void[0];
    const ratio = SE.webDensity(SEED, nd.pos) / SE.webDensity(SEED, vd.pos);
    expect(ratio).toBeGreaterThan(50);
  });
  it("ダスト: 決定性・地平線・環帯・光束比", () => {
    const a = SE.sampleWebDust(SEED, CELL, 2, 60000, [1.4, 2.7]);
    const b = SE.sampleWebDust(SEED, CELL, 2, 60000, [1.4, 2.7]);
    expect(a.pts).toEqual(b.pts);
    expect(a.w).toEqual(b.w);
    // 地平線: feather 上限の外に点が無い
    const c = [CELL[0] + 0.5, CELL[1] + 0.5, CELL[2] + 0.5];
    const dist = (i: number) => Math.hypot(a.pts[i * 3] - c[0], a.pts[i * 3 + 1] - c[1], a.pts[i * 3 + 2] - c[2]);
    const n = a.pts.length / 3;
    let fluxIn = 0, fluxOut = 0;
    for (let i = 0; i < n; i++) {
      const d = dist(i);
      expect(d).toBeLessThanOrEqual(2.7 + 1e-9);
      if (d < 1.0) fluxIn += a.w[i];
      else if (d >= 2.0) fluxOut += a.w[i];
    }
    // 光束/体積: 内球(r<1)と外殻(2.0..2.7)で 5 倍以上
    const volIn = (4 / 3) * Math.PI;
    const volOut = (4 / 3) * Math.PI * (2.7 ** 3 - 2.0 ** 3);
    expect((fluxIn / volIn) / (fluxOut / volOut)).toBeGreaterThan(5);
    // 環帯サンプリング(minR)の厳守
    const ring = SE.sampleWebDust(SEED, CELL, 4, 30000, [3.2, 4.7], 2.55);
    for (let i = 0; i < ring.pts.length / 3; i++) {
      const d = Math.hypot(ring.pts[i * 3] - c[0], ring.pts[i * 3 + 1] - c[1], ring.pts[i * 3 + 2] - c[2]);
      expect(d).toBeGreaterThanOrEqual(2.55);
      expect(d).toBeLessThanOrEqual(4.7 + 1e-9);
    }
  });
});

describe("生成の親子整合(衛星継承)", () => {
  function planetWithMoons(): Address {
    // 初期惑星に衛星が無い場合に備え、兄弟から衛星持ちを探す
    const init = parse(KNOWN_INITIAL);
    const parent = SE.parentAddress(init)!;
    const count = SE.canonicalChildCount(parent, "P");
    for (let i = 0; i < count; i++) {
      const a: Address = { seed: SEED, segs: [...parent.segs, { k: "P", i }] };
      if ((SE.resolve(a).params as PlanetParams).moons.length > 0) return a;
    }
    throw new Error("no planet with moons found");
  }
  it("radius・色・hasAtmo の継承と cache 非依存", () => {
    const p = planetWithMoons();
    const moons = (SE.resolve(p).params as PlanetParams).moons;
    const m0: Address = { seed: SEED, segs: [...p.segs, { k: "M", i: 0 }] };
    const md = SE.resolveFresh(m0);
    const mp = md.params as PlanetParams;
    expect(mp.radius).toBe(0.4 + moons[0].size * 3.5); // 厳密一致
    expect(mp.hasAtmo).toBe(false);
    // base の平均が親 shade に近い(mix 0.6)
    const avg = (mp.base[0] + mp.base[1] + mp.base[2]) / 3;
    expect(Math.abs(avg - moons[0].shade)).toBeLessThan(0.25);
    const fp = md.fingerprint;
    SE.clearCache();
    expect(SE.resolveFresh(m0).fingerprint).toBe(fp);
  });
  it("範囲外衛星 index・スキップ階層 M が解決可能(継承なし)", () => {
    const p = planetWithMoons();
    const out: Address = { seed: SEED, segs: [...p.segs, { k: "M", i: 99 }] };
    const d = SE.resolveFresh(out);
    expect(d.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    const skip = parse("S7f3e2d/M:2");
    expect(SE.resolveFresh(skip).bodyType).toBe("planet");
  });
});
