# 実装計画 — artifact 版 space-explorer の Vite + React + TypeScript 移植

- 日付: 2026-07-05
- 状態: 承認待ち
- 目的: `reference/space-explorer.html`(単一 HTML artifact)を、挙動・見た目・identity を
  完全維持したまま Vite + React + TypeScript のリポジトリ構成へ移植する。機能変更ゼロ。
- 正とする文書: `docs/internal/specs/00〜08`、`docs/internal/contracts/porting-invariants.md`
- 備考: specs が参照する 90-roadmap.md(移植方針の原文書)は入手できていない。
  本計画は specs 本文と contracts から独立に立てたものである。入手でき次第、差分を反映する。

## 成果物の構成

    index.html                  ルート div とビューポート設定のみ
    vite.config.ts
    package.json                three@0.128.0(固定)、react、react-dom、vitest
    src/
      core/
        se.ts                   CORE 全体。artifact の IIFE 構造を保った単一モジュール
        types.ts                Address / Segment / Descriptor / PlanetParams などの型
      render/
        renderer.ts             R モジュール(ステージ、buildSky、テクスチャ、操作、capture)
      ui/
        App.tsx                 画面全体。readout / HUD / パネル / トースト / veil
        controller.ts           focusAddress・transitionTo・stageData・品質・安全網
        (必要に応じて Hud.tsx / panels/*.tsx に分割)
      styles.css                artifact の <style> ブロックをそのまま移設(ID・クラス維持)
      main.tsx                  StrictMode なしで App をマウント
    tests/
      core.test.ts              specs/07-verification.md の回帰項目
      parity.test.ts            旧 CORE(reference から抽出)との fingerprint 全一致照合

CORE を単一ファイルに保つ理由: resolve ↔ canonicalChildCount ↔ cellFeatures の相互参照が
多く、ファイル分割は乱数消費順の破壊やモジュール循環のリスクだけを増やす。
分割は移植完了・検証通過後の別計画とする。

## マイルストーン

### M1. スキャフォールド
- [ ] Vite + React + TS(strict)を初期化。three@0.128.0 を固定インストール
- [ ] vitest 導入。`npm run dev / build / test` が動くこと

### M2. CORE 移植
- [ ] `src/core/se.ts` へ CORE-BEGIN/END 間を型付けして移植
- [ ] DOM / THREE への依存ゼロ(import なし)を確認

### M3. CORE 検証(ゲート — 通過まで M4 に進まない)
- [ ] specs/07 の回帰項目を tests/core.test.ts に実装
      (往復シリアライズ、不正入力拒否、キャッシュ非依存、兄弟 512 件衝突ゼロ、
       ノードの所有・等距離・空球条件、ダスト決定性・範囲、衛星継承、zoomPath 系)
- [ ] 既知の正解値 2 件の一致(contracts §2)
- [ ] parity.test.ts: reference/space-explorer.html から sed で旧 CORE を抽出し、
      多数のランダム address で新旧 fingerprint・serialize・正規個数の全一致を照合

### M4. render 層移植
- [ ] renderer.ts へ R モジュールを逐語移植(定数・ソルト・式は一切変更しない)
- [ ] React からは div ref へのマウントのみ。レンダーループは React 外

### M5. ui 層移植
- [ ] styles.css へ <style> を移設、JSX で同一 DOM 構造を再現
- [ ] controller.ts へ focusAddress / transitionTo / stageData / candInfo /
      品質 4 段(QUALITIES・perfWatch 降格・コンテキスト喪失時 std 復帰)を移植
- [ ] パネル排他・トースト 1.5s・veil 0.28s・手帳ドット(新規追加時のみアニメーション)
      など specs/06 の挙動を React で維持
- [ ] 起動: initialAddress(DEFAULT_SEED)、Z=4(specs/06「起動」)

### M6. 最終検証
- [ ] `npm run build` と `npm test` 全通過
- [ ] 実機確認(specs/07「実機での確認観点」):
      Z −0.25→4.05 往復で二重表示・消失なし / 宇宙網の縁が輪郭に見えない /
      jump → ズームアウト → 手帳帰還 → Verify 一周で同一 fingerprint /
      HUD の初期 address・FP が contracts §2 と一致 / 品質切替と撮影保存

## ワークフロー

1. 各マイルストーンで仕様との差異が必要になった場合は、先に specs / contracts /
   本計画を修正し、その後にコードを変更する(contracts §5)。
2. 本計画のチェックボックスを進捗として更新する。
3. 移植で発見した artifact 版の不具合は「そのまま移植」を優先し、修正せず
   本計画末尾の「発見事項」に記録して別途判断を仰ぐ。

## 発見事項

(なし)
