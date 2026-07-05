# 10 — identity: address、ハッシュ連鎖、fingerprint

この文書は対象の同一性を定義する。本文書の内容はすべて [不変] である。ここに記す関数はビット単位で正確に再実装されなければならない。数値はすべて 32bit 符号なし整数演算(JavaScript では `>>> 0` と `Math.imul` による)で行う。

## ハッシュプリミティブ

```js
function mix32(h){
  h = h >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15; h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}
// 順序依存の連鎖合成
function combine(h, x){
  h = (h ^ mix32((x >>> 0) + 0x9e3779b9)) >>> 0;
  return mix32((h + 0x85ebca6b) >>> 0);
}
function chain(h, ...xs){ for(const x of xs) h = combine(h, x); return h; }
// FNV-1a → mix32
function hashStr(s){
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}
// 決定論的乱数列
function mulberry32(a){
  a = a >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex8 = h => (h >>> 0).toString(16).padStart(8, "0");
```

負の整数(セル座標)は `x >>> 0` により 2 の補数表現のまま合成される。

## address のデータモデル

address は seed 文字列と segment 列の組である。

    addr = { seed: string, segs: Segment[] }
    Segment = { k:"W", cell:[int,int,int], f:{ kind, id, local? } }
            | { k:"C"|"G"|"Y"|"P"|"M", i:int }

segment 種別の意味: W = 宇宙網 feature、C = 銀河団領域(cluster region)、G = 銀河、Y = 恒星系、P = 惑星、M = 衛星。W の f.kind は "void" | "wall" | "filament" | "node" のいずれか(この配列順を WEB_KINDS と呼び、index が分類 ID として合成に使われる)。

順序規則: segs は W → C → G → Y → P → M の順で並び、各種別は高々1回。任意の接尾は省略でき(深さの浅い対象)、中間の省略(例: S/W/G)も有効である。

## 文字列形式(シリアライズ)

    "S" + seed
      ( "/W:cell=" x "," y "," z ";f=" kind "," id [ "," local ] )?
      ( "/C:" i )? ( "/G:" i )? ( "/Y:" i )? ( "/P:" i )? ( "/M:" i )?

例:

    S7f3e2d/W:cell=14,-17,16;f=node,0/C:2/G:5/Y:15/P:1

パース規則:

- 先頭 segment は正規表現 `^S[A-Za-z0-9\-]{1,32}$` に一致すること。seed はこの英数字・ハイフン列である。
- 後続 segment の種別順は厳密に増加(SEG_ORDER = [W,C,G,Y,P,M] の index が単調増加)。違反・重複は拒否。
- W: `cell` は整数3つ、各 |v| < 1,000,000。`f` は kind(WEB_KINDS のいずれか)、id、任意の local。id と local は 0 以上 1,000,000 未満の整数。
- C/G/Y/P/M: `^[CGYPM]:(\d{1,7})$` に一致し、値は 1,000,000 未満。
- パースは Result 型(ok / error)で返し、例外を投げない。
- serialize(parse(s)) は正規形を返す。往復で segment 種別・index・親子関係・セル情報が保存される。

## ハッシュ連鎖(chainHash)

address 全体の 32bit 状態は次で定義される。TAG 定数は
S:0x53, W:0x57, C:0x43, G:0x47, Y:0x59, P:0x50, M:0x4d, INIT:0x1234abcd, LOCAL_NONE:0x7fffffff。

```js
function chainHash(addr){
  let h = chain(hashStr(addr.seed), TAG.S);
  for(const s of addr.segs){
    if(s.k === "W"){
      h = chain(h, TAG.W, s.cell[0], s.cell[1], s.cell[2],
                WEB_KINDS.indexOf(s.f.kind), s.f.id,
                s.f.local === undefined ? TAG.LOCAL_NONE : s.f.local);
    }else{
      h = chain(h, TAG[s.k], s.i);
    }
  }
  return h;
}
```

deepestKind(addr) は最後の segment の k、segs が空なら "S" を返す。

## resolve と fingerprint

resolveFresh(addr) は次を行う: h = chainHash(addr)、kind = deepestKind(addr)、rng = mulberry32(h)。kind が P または M なら genPlanet(rng, kind==="M") でパラメータを生成し(M の場合はさらに親からの継承、20-generation.md)、fingerprintPlanet で fingerprint を得る。それ以外は genProxy(rng, kind) と fingerprintProxy。戻り値は
{ kind, kindLabel, bodyType("planet"|"proxy"), params, fingerprint, chain: h }。

fingerprint は安定パラメータの量子化列を連鎖ハッシュした hex 8 桁である。量子化は q(v) = round(v×1000)、色は rgbInt(c) = (round(r×255)<<16)|(round(g×255)<<8)|round(b×255)。

```js
// 惑星・衛星。開始値 0xC0FFEE11、フィールド順は固定
h = chain(0xC0FFEE11, hashStr(archetype), q(radius),
  rgbInt(base), rgbInt(alt), rgbInt(band), rgbInt(pole), rgbInt(atmo),
  hasAtmo?1:0, bands, q(noiseScale), q(poleCap), q(tilt), q(spin));
if(ring) h = chain(h, 1, q(ring.inner), q(ring.outer), q(ring.alpha),
                   rgbInt(ring.tint), ring.seed);
else     h = chain(h, 0);
h = chain(h, moons.length);
for(const m of moons)
  h = chain(h, q(m.size), q(m.dist), q(m.speed), q(m.phase), q(m.incl), q(m.shade));
fingerprint = hex8(h);

// プロキシ(S/W/C/G/Y)。開始値 0xC0FFEE22
fingerprint = hex8(chain(0xC0FFEE22, hashStr(kind), rgbInt(color), q(glow), q(pulse)));
```

## キャッシュ [不変(意味論)/ 方式(実装)]

resolve(addr) は serialize(addr) をキーとする Map メモ化付きの resolveFresh である。clearCache() は resolve のキャッシュと宇宙網列挙のメモ(30-cosmic-web.md)を両方消去する。キャッシュの有無は結果に影響してはならず、verify 操作は必ず resolveFresh 経路(文字列からの再パース → 再生成)で fingerprint を比較する。

## 正規個数(canonical count)と範囲外 index

親の下の正規の子個数は canonicalChildCount(parent, childKind) で決まる。SALT_COUNT = 0xC41D5。

- childKind が M かつ親が P のとき: resolve(parent).params.moons.length(親が見せる衛星数と厳密一致)。
- それ以外: rng = mulberry32(chain(chainHash(parent), TAG[childKind], SALT_COUNT)) を用い、
  C: 親 W の f.kind により node 2..5 / filament 1..3 / wall 1..2 / void 0..1(親が W でなければ node 扱い)、
  G: 8..20、Y: 10..24、P: 3..8、M(スキップ階層): 0..2。
  いずれも `min + floor(rng()×span)`。

候補列挙(60-ui-state.md、40-zoom.md)はこの正規範囲に限定されるが、jump は範囲外 index(例 P:999)も通常どおり resolve する。範囲外対象は幾何的配置を持たない場合があるが(30-cosmic-web.md の webFeature.exists 参照)、同一性・fingerprint・再訪問性は正規対象と等価に保証される。

## 初期 address

initialAddress(seed) は次の決定論的手続きで得る。rng = mulberry32(chain(hashStr(seed), TAG.INIT))、ri(n) = floor(rng()×n)。

1. cell = [ri(49)−24, ri(49)−24, ri(49)−24] を引く。cellFeatures(seed, cell).node が空なら引き直す(最大 64 回、rng は消費され続ける)。
2. node id = ri(ノード数)(ノードが無ければ 0)。
3. C, G, Y, P の順に、n = canonicalChildCount(現在の addr, 種別) を求め、n = 0 なら打ち切り、そうでなければ i = ri(n) を追加する。

これにより初期惑星は実在するノード上にあり、全 index が正規範囲に収まる。デフォルト seed "7f3e2d" の結果は 00-overview.md の基準値の通り。

## 互換性の注記

過去の列挙方式に由来する address(例: S7f3e2d/W:cell=14,-17,16;f=node,1 …)は、現在の宇宙網列挙に存在しない feature を指すことがある。それらも identity としては通常どおり解決され(この例の惑星 …/C:3/G:37/Y:21/P:3 の fingerprint は 0136482c)、宇宙網ステージでの配置だけを持たない。
