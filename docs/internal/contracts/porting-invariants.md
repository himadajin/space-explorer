# 移植契約 — Vite + React + TypeScript 版が破ってはならないもの

本書は、artifact 版(単一 HTML)から本リポジトリへの移植において、
いかなるリファクタリングでも破ってはならない契約を列挙する。詳細な定義はすべて
`docs/internal/specs/` を正とし、本書は参照とゲート条件のみを持つ。

註: 移植期間中は原本を `reference/space-explorer.html` として保持し、新旧 CORE の
ビット一致を機械照合した。移植完了(2026-07-05)をもって原本と照合テストは削除済み。
以後の恒久ゲートは §2 の既知の正解値(tests/core.test.ts)である。

## 1. CORE のビット互換 [不変]

- specs/01-identity.md・02-generation.md・03-cosmic-web.md(列挙部)に定義される全関数は、
  乱数消費順・分布・32bit 演算(`>>> 0` / `Math.imul`)を含めてビット単位で同一であること。
- キャッシュの有無は結果に影響しないこと(resolve と resolveFresh の一致)。
- CORE モジュールは DOM にも Three.js にも依存しないこと(Node.js 単体で実行可能)。

## 2. 既知の正解値(最終判定)[不変]

    seed "7f3e2d":
      initialAddress = S7f3e2d/W:cell=14,-17,16;f=node,0/C:2/G:5/Y:15/P:1
      fingerprint    = ef3eeabe(ガス型惑星)
    旧列挙互換:
      S7f3e2d/W:cell=14,-17,16;f=node,1/C:3/G:37/Y:21/P:3 → 0136482c
      (webFeature.exists = false だが identity は有効)

## 3. 表示の等価性 [方式]

- Three.js は **r128(npm `three@0.128.0`)に固定**する。以降のバージョンは
  カラーマネジメント既定値の変更等で絵が変わるため、更新は意図的な決断として
  specs/05-art.md の再検証を伴うこと。
- render / ui 層の定数(色・サイズ・不透明度・点数・イージング・K_j 等)は
  artifact 版の値をそのまま用いる。変更する場合は先に specs を修正する。

## 4. アーキテクチャ上の禁止事項

- localStorage 等のブラウザ永続化を導入しない(specs/06-ui-state.md、ADR-4)。
- React の再レンダリングをレンダーループ(requestAnimationFrame)に関与させない。
  レンダラーは React 外のシングルトンとし、React は DOM(HUD・パネル)のみを持つ。
- StrictMode は使用しない(レンダラー二重初期化の防止)。

## 5. ワークフロー契約

仕様・挙動に関わる変更は、必ず `docs/internal/specs/`(または本書・plans)の修正を
先に行い、その後にコードを修正する。コードだけが先行して仕様と食い違う状態を作らない。

変更種別ごとの検証義務は specs/07-verification.md の対応表に従う。
