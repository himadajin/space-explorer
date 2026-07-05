# 20 — generation: 天体パラメータと共有導出

この文書は resolve が返す安定パラメータの生成を定義する。genPlanet / genProxy / 衛星継承は fingerprint の入力を構成するため、乱数の消費順・分布を含めて [不変] である。rng は 10-identity.md の mulberry32(chainHash(addr)) であり、以下の記述順がそのまま消費順である。

## genPlanet(rng, isMoon) [不変]

すべての値域は `a + rng()×b` 形式(一様)で書く。分岐で消費数が変わる箇所は分岐ごとに明記する。

1. roll = rng()。archetype: isMoon のとき roll<0.8 → "rocky"、それ以外 → "ice"。惑星のとき roll<0.55 → "rocky"、<0.80 → "gas"、それ以外 → "ice"。
2. radius: isMoon → 0.45 + rng()×0.35。gas → 1.0 + rng()×0.6。その他 → 0.55 + rng()×0.45。
3. 色相・彩度・明度(archetype で分岐、各分岐とも 3 draw):
   rocky: hue = [0.02,0.07,0.10,0.32,0.58][floor(rng()×5)] + rng()×0.03、sat = 0.25+rng()×0.3、lit = 0.34+rng()×0.14。
   gas: hue = [0.06,0.09,0.13,0.48,0.90][floor(rng()×5)] + rng()×0.04、sat = 0.30+rng()×0.35、lit = 0.48+rng()×0.16。
   ice: hue = 0.50+rng()×0.14、sat = 0.12+rng()×0.22、lit = 0.62+rng()×0.18(配列 draw なし、3 draw)。
   注意: rocky / gas は floor 用と加算用で hue に 2 draw を使う(計 4 draw)。
4. パレット(hsl2rgb は 10-identity.md 記載の純関数):
   base = hsl2rgb(hue, sat, lit)。
   alt = hsl2rgb(hue+(rng()−0.5)×0.09, sat×(0.7+rng()×0.5), lit×(0.72+rng()×0.3))(3 draw)。
   band = hsl2rgb(hue+(rng()−0.5)×0.16, min(1, sat×1.2), lit×(0.85+rng()×0.35))(2 draw)。
   pole = hsl2rgb(hue+0.02, sat×0.25, 0.82+rng()×0.12)(1 draw)。
   atmo = hsl2rgb(hue+(rng()<0.5 ? 0.05 : −0.05), 0.5, 0.65)(1 draw)。
5. hasAtmo: gas は無条件 true(draw なし)。それ以外は rng()<0.6(1 draw)。
6. bands: gas のみ 4+floor(rng()×7)(1 draw)。それ以外は 0(draw なし)。
7. noiseScale = 2.5 + rng()×4。
8. poleCap: archetype≠gas かつ rng()<0.55 のとき 0.72+rng()×0.15(2 draw)、条件を満たさない非 gas は 1 draw のみ消費して 0。gas は判定式の短絡により draw なしで 0。
   実装上の正確な式: `archetype !== "gas" && rng() < 0.55 ? 0.72 + rng()*0.15 : 0`(JavaScript の評価順に従う)。
9. tilt = (rng()−0.5)×0.9。spin = 0.03 + rng()×0.08。
10. ringRoll = rng()。ringP = gas 0.45 / ice 0.15 / rocky 0.05。isMoon でなく ringRoll<ringP のとき ring を生成(5 draw):
    inner = 1.35+rng()×0.25、outer = 1.9+rng()×0.7、alpha = 0.35+rng()×0.35、
    tint = hsl2rgb(hue+(rng()−0.5)×0.06, sat×0.5, 0.6+rng()×0.2)(2 draw)、
    seed = floor(rng()×0xffffffff)。
11. moonCount: isMoon → 0(draw なし)。それ以外 floor(rng() × (gas ? 5.6 : 3.4))。
12. 各衛星 i(6 draw / 個、i 昇順):
    size = 0.05+rng()×0.07、dist = 2.1 + i×0.75 + rng()×0.5、
    speed = (0.10+rng()×0.16) × (rng()<0.12 ? −1 : 1)(2 draw)、
    phase = rng()×2π、incl = (rng()−0.5)×0.4、shade = 0.45+rng()×0.35。

戻り値のフィールドは { archetype, radius, base, alt, band, pole, atmo, hasAtmo, bands, noiseScale, poleCap, tilt, spin, ring, moons }。

## 衛星の親からの継承 [不変]

kind が M で、親(segs を 1 つ削った address)の deepestKind が P であり、親の params.moons[i](i は M segment の index)が存在する場合、genPlanet(rng, true) の結果に対して次を上書きした後に fingerprint を計算する。

    radius  = 0.4 + mm.size × 3.5
    g       = [mm.shade, mm.shade, mm.shade×1.04]
    base    = mix(base, g, 0.6)   // 成分ごとの線形補間
    alt     = mix(alt,  g, 0.6)
    band    = mix(band, g, 0.45)
    hasAtmo = false

親の params は resolve(parent)(キャッシュ可)から取得する。これにより「親惑星の周りを回る点の大きさと色調」と「その衛星に focus したときの姿」が同じ安定パラメータから導出される。範囲外の衛星 index やスキップ階層の M(親が P でない)には継承を適用せず、素の genPlanet(rng, true) の結果を用いる。

## genProxy(rng, kind) [不変]

P/M 以外の深さ(S/W/C/G/Y)の対象は proxy として解決される。

    hueBase = { S:0.62, W:0.58, C:0.75, G:0.68, Y:0.12 }[kind]
    hue   = hueBase + (rng()−0.5)×0.1
    color = hsl2rgb(hue, 0.45+rng()×0.3, 0.6+rng()×0.2)   // 2 draw
    radius = 0.9(固定)
    glow  = 0.6+rng()×0.4
    pulse = 0.4+rng()×0.6

proxy の color は表示の基礎色(銀河の tint、候補の色片など)として広く参照される。表示側での脱色(desaturation)は許されるが、params.color 自体を変えることは fingerprint の変更を意味する。

## 共有導出の原則 [方式]

二つ以上のスケールに現れる視覚的性質は、単一の導出関数から引かなければならない。現在の共有導出は次の通り(ソルトと式は 40-zoom.md / 50-art.md 参照)。

- 銀河の向き orientationOf(chain): 銀河団での外観平面の傾き、銀河内部円盤の傾き、惑星から見た天の川の帯の向き、の三者を共有する。
- 恒星色 starColorOf(chain): 銀河内で見える恒星系の光点の色と、恒星系での太陽の色を共有する。
- 衛星継承(上記): 親の見せる衛星と衛星 detail を共有する。
- 銀河の星の部分集合: 銀河内部点群の生成列(salt 0xB061)は先頭から順に消費されるため、少数 N 点だけ生成すればフル点群の先頭 N 点と厳密に一致する。遠くの銀河はこの部分集合で描かれる(同じ星が疎に解像される)。

これらは表示のための導出であり fingerprint には含まれないが、原則自体は本アプリの親子整合(00-overview.md 不変条件 7)を支える規範である。新しい表現を足すときは、まず既存の安定パラメータ・chain から導出できないかを検討する。
