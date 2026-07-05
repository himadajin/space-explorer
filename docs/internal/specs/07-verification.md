# 70 — verification: 検証の方法と既知の正解値

生成ロジック(CORE)は DOM にも Three.js にも依存しない純関数群であり、Node.js で回帰検証できることが本アプリの保守の前提である [方式]。UI 内の Verify ボタン(60-ui-state.md)は同じ性質のユーザー向け表現である。

## CORE の抽出と実行

HTML 内のコメントマーカー間を切り出し、window スタブを前置して実行する。

    sed -n '/\/\* CORE-BEGIN \*\//,/\/\* CORE-END \*\//p' space-explorer.html > core.js
    printf 'const window={};\n' > wrap.js && cat core.js >> wrap.js
    cat tests.js >> wrap.js && node wrap.js

CORE が公開する API: mix32, combine, chain, hashStr, mulberry32, hex8, WEB_KINDS, KIND_LABEL, STAGE_OF_KIND, serializeAddress, parseAddress, chainHash, deepestKind, resolve, resolveFresh, clearCache, initialAddress, parentAddress, canonicalChildCount, neighborhood, zoomPath, seedPointOf, fDistances, webDensity, cellFeatures, webFeature, sampleWebDust。

## 既知の正解値 [不変]

再実装の一致検証は最終的にこの値で判定する。

    seed "7f3e2d":
      initialAddress = S7f3e2d/W:cell=14,-17,16;f=node,0/C:2/G:5/Y:15/P:1
      その fingerprint = ef3eeabe(archetype: gas)
    旧列挙由来の互換例:
      S7f3e2d/W:cell=14,-17,16;f=node,1/C:3/G:37/Y:21/P:3 → fingerprint 0136482c
      (この node,1 は現行列挙に存在せず webFeature.exists = false、identity は有効)

## 回帰テスト項目

identity / address:

- serialize(parse(s)) の往復一致(接尾省略、スキップ階層 S/W/G、local 付き filament、負のセル座標、別 seed を含む)。
- 不正入力の拒否: 順序違反、重複 segment、範囲外 index(≥1e6)、未知種別、不正な W フィールド、不正 seed。
- resolveFresh の決定性、および clearCache 前後で resolve と resolveFresh の fingerprint が一致(キャッシュ非依存)。
- 兄弟 512 件(G×Y×P 各 8)で fingerprint 衝突ゼロ。異なる seed で初期 fingerprint が分岐。

neighborhood / zoomPath:

- 候補集合の署名(全候補の address+fingerprint 連結)が clearCache 前後で一致。
- 惑星の子候補数 = params.moons.length。兄弟数 = 正規個数 − 1(自己除外)。範囲外 focus(P:999)では正規候補が全件列挙される。
- スキップ階層の兄弟列挙が (親, 自 kind) の正規個数に従う。
- zoomPath: 惑星 focus で 5 anchor すべて充填され各 anchor が focus の接頭辞。銀河 focus の代表降下が正規範囲内で再現。スキップ階層で該当ステージが null。衛星 focus で stage0 = 衛星自身。子個数 0(空のボイド)で降下が停止。ルート(S のみ)からの降下が安定。

cosmic web:

- 全ノードが「所有セル内包」「4 親種点への等距離(誤差 1e-6)」「空球条件(F4 = 外接球半径、誤差 1e-6)」を満たす(±2 セル走査、期待規模: 125 セルで 200 前後)。
- cellFeatures の JSON 署名が clearCache 前後で一致。フィラメントが両端ノード座標を持つ。feature address が一意で往復可能。列挙された全兄弟が webFeature.exists。
- 密度: ノード位置 ≫ ボイド位置(比 50 以上。現行値 ≈ 340)。
- ダスト: 同一引数で完全一致(決定性)。地平線(feather 上限)外の点ゼロ。光束(密度×輝度)/体積が内側と外殻で 5 倍以上(現行 ≈ 10 倍)。環帯サンプリング(minR)が範囲を厳守。点数と生成時間の目安: 600k 試行 ≈ 9.1k 点 / ~220ms。

生成の親子整合:

- 衛星継承: radius = 0.4 + size×3.5(厳密一致)、base の平均が親 shade に近い、hasAtmo = false。継承経路(resolve(parent) 使用)でも clearCache 前後で fingerprint 一致。範囲外衛星 index・スキップ階層 M が解決可能。

## 変更種別ごとの検証対応

    core/hash・address・fingerprint に触れた → 全項目 + 既知の正解値。値が変わる変更は
      互換性破壊であり、意図的な決断と正解値の更新を伴う。
    genPlanet / genProxy / 継承に触れた → identity 系 + 正解値(fingerprint が変わる)。
    宇宙網の列挙(種点・ノード・feature)に触れた → cosmic web 系 + initialAddress の再確認
      (初期 address が変わり得る)。
    密度場・ダスト・描画定数のみ → ダストの決定性と範囲のみ。fingerprint 正解値は不変のはず。
    render / ui のみ → CORE テストは不変のはずであることを確認(identity 回帰のみ)。
      加えて実機確認: スマホ縦画面での操作、品質切替、性能監視の誤発動有無。

## 実機での確認観点(自動化されない項目)

ズーム全域(Z −0.25 → 4.05)を往復して、焦点対象の二重表示・消失・位置ジャンプがないこと。宇宙網の縁が輪郭として見えないこと。jump → ズームアウト → 手帳帰還 → Verify の一周で同じ fingerprint に戻ること。std 初期のスマートフォンでフレームレートが破綻しないこと。still 切替(約 2 秒の再構築)と撮影の保存。
