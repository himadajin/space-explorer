# 30 — cosmic web: Worley 型近似による大規模構造

宇宙の最上位構造(ボイド・ウォール・フィラメント・ノード)は、厳密なボロノイ幾何ではなく Worley noise 型の近似で実装される [方式]。ただし feature の列挙結果は address の配置と正規個数の一部を支えるため、本文書のアルゴリズムのうち「列挙」に関わる部分(種点、ノード、フィラメント、ウォール、ボイド、順序)は事実上 [不変] に準じて扱う(変更すると既存 address の幾何配置と initialAddress が変わる)。密度場とダストは表示専用で [調整] を含む。

## 種点 [不変に準ずる]

グリッドセル 1 個につき種点 1 個。SALT_SEEDPT = 0x5EED0。

    seedPointOf(seed, cx, cy, cz):
      rng = mulberry32(chain(hashStr(seed), SALT_SEEDPT, cx, cy, cz))
      return [cx + rng(), cy + rng(), cz + rng()]

セルの一辺は 1。以降の距離はすべてこのセル単位である。

## F 距離と分類

任意の点 p に対し、p の属するセル ±1(3×3×3 = 27 セル)の種点との距離を昇順に並べたものを F1..F4 とする(fDistances)。分類の直観は、F2−F1 が小さい帯 = ウォール、F3−F1 が小さい帯 = フィラメント、F4−F1 が小さい点 = ノード、それ以外のセル内部 = ボイド。分類は明示的な閾値関数としては実装されず、密度場(後述)と feature 列挙が同じ量から導かれる。

## ノード(ボロノイ頂点)[不変に準ずる]

セル C が所有するノードは次で列挙される(cellNodes)。

1. C の ±1 の 27 種点を集める。C 自身の種点を own とする。
2. own 以外を own への距離昇順に並べ、先頭 10 個を候補とする。
3. 候補から 3 個を選ぶ全組合せ(C(10,3) = 120)について、own + 3 点の外接球中心 cc を線形方程式で解く(退化 |det| < 1e-9 は棄却)。
4. cc を含むセルが C であること(所有規則)。
5. 空球条件: 27 種点のうち 4 親以外のどれも、外接球の内側(距離² < 半径² − 1e-9)にないこと。
6. 位置キー(各座標 ×4096 を丸めた整数の組)で重複排除。
7. 量子化座標 (x, y, z) の辞書式で整列。この順序が node の id である。

各ノードは pos(外接球中心)と parents(4 親セルのキー、整列済み)を持つ。構成上、ノードは 4 親種点に等距離であり、空球条件により F1..F4 がすべて外接球半径に一致する(検証項目、70-verification.md)。

## フィラメント・ウォール・ボイド [不変に準ずる]

cellFeatures(seed, cell) は種別ごとの整列済みリストを返す。

- filament: cell ±1 の全ノード(27 セルぶんの cellNodes)から、親セルをちょうど 3 個共有するノード対を取り、中点が cell に含まれるものを採用。中点キーで重複排除し、量子化中点の辞書式で整列。各要素は pos(中点)と両端 a, b(ノード座標)を持つ。
- wall: 27 種点の全対(i<j)について中点が cell に含まれ、かつ中点の最近傍 2 種点がちょうどその対であるものを採用。量子化中点で整列。
- void: 常に 1 個。cell 自身の種点位置。
- node: 上記の通り。

feature の address は W segment(cell = 所有セル、kind、id = 上記リスト内 index)である。webFeature(seed, wseg) は該当 feature の { exists, pos, a?, b? } を返し、列挙外の index は exists=false(配置なし、identity は有効)。

webFeaturesAround(seed, cell) は cell ±1 の 27 セルを dx, dy, dz の三重ループ(各 −1..1 昇順)で走査し、各セルについて WEB_KINDS 順(void, wall, filament, node)、id 昇順で address を列挙する。この順序は neighborhood と zoomPath の代表選択に影響するため固定である。

## メモ化 [方式]

cellNodes と cellFeatures は "種別|seed|セルキー" をキーとする Map でメモ化される(上限 4000 エントリ、超過で全消去)。純粋な導出のキャッシュであり意味論に影響しない。clearCache() は resolve キャッシュと同時にこのメモも消去する。

## 密度場 [調整]

    webDensity(seed, p):
      s = fDistances(seed, p); w = s2−s1; f = s3−s1; n = s4−s1
      return 0.06·exp(−w²/0.014) + 0.30·exp(−f²/0.006)
           + 1.00·exp(−n²/0.0035) + 0.004

ノード近傍で最大(≈1.4)、深いボイドで 0.004。この明暗比(約 340 倍)が「物質が構造に集まる」見た目を支える。係数・分散は表示チューニング可。

## ダストサンプラー [調整(決定性は不変)]

sampleWebDust(seed, cell, r, attempts, featherR?, minR?) は棄却サンプリングで点群を返す。SALT_DUST = 0xD0570。

1. rng = mulberry32(chain(hashStr(seed), SALT_DUST, cell))。
2. ±(r+1) の種点グリッドを先に全構築する(高速化。数十万試行に耐える)。
3. 各試行: p を ±r の箱内で一様に引く(3 draw)。
   minR があり、セル中心(cell+0.5)からの距離 dist < minR なら棄却(環帯サンプリング)。
   featherR = [r0, r1] があれば fw = clamp(1 − (dist−r0)/(r1−r0), 0, 1)、fw ≤ 0 なら棄却。
   p の属するセル ±1 の 27 種点(グリッドから直接参照)で F1..F4 を挿入法で求め、密度 dens を上式で計算。
   rng() < dens×fw なら採用し、pts に p、w に min(1, dens)×(0.35+0.65×fw) を積む。
4. 戻り値 { pts:number[], w:number[] }。

同じ引数に対して結果は完全に決定論的である。フェザリングにより、描画データの果ては輪郭ではなく闇への溶け込みとして読まれる(「宇宙の外側」を見せないための必須要素、80-decisions.md ADR-9)。

現在の呼び出しパラメータ(60-ui-state.md の品質倍率 mult を掛ける):

    近傍: r=2, attempts = 600000×mult, feather [1.4, 2.7]
    遠方環帯: r=4, attempts = min(600000, 90000×mult), feather [3.2, 4.7], minR 2.55
             (輝度は合流時に ×0.55)
    遠景ノード焼き込み(mult≥2): チェビシェフ距離 2 の殻の各セルの node について、
      salt 0xFA96 の rng で ±0.05 のジッタ点を 8 個、w = (0.5+0.4·rng)×feather

実測の目安(Node.js): 近傍 600k 試行 ≈ 9.1k 点 / 220ms、still(×8)≈ 72.6k 点 / 1.8s。
