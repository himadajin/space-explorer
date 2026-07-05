# 実装計画 — artifact 版 space-explorer の Vite + React + TypeScript 移植

- 日付: 2026-07-05
- 状態: 完了(スマートフォン実機での操作感確認のみ残、下記 M6 参照)
- 目的: artifact 版(単一 HTML)を、挙動・見た目・identity を完全維持したまま
  Vite + React + TypeScript のリポジトリ構成へ移植する。機能変更ゼロ。
- 正とする文書: `docs/internal/specs/00〜90`、`docs/internal/contracts/porting-invariants.md`
- 備考: specs/90-roadmap.md の移植方針と本計画の対応:
  CORE → src/core の TS モジュール化 / 回帰テスト → vitest / render 層は
  canvas 保持の 1 コンポーネント + 命令的モジュール / UI 層は React 化して
  state を store に写像 / three は r128 のまま(バージョン更新は別途の意思決定)。
  90-roadmap.md「先送りした構想」(無限化・命名・短縮 address・seed UI 等)は
  本移植では一切実装していない。
- `reference/`(artifact 原本)は移植期間中の照合専用であり、完了後に削除済み(M7)。

## 成果物の構成

    index.html                  ルート div とビューポート設定のみ
    vite.config.ts
    package.json                three@0.128.0(固定)+ @types/three@0.128.0、react、react-dom、vitest
    src/
      core/
        se.ts                   CORE 全体。artifact の IIFE 構造を保った単一モジュール
        types.ts                Address / Segment / Descriptor / PlanetParams などの型
      render/
        renderer.ts             R モジュール(ステージ、buildSky、テクスチャ、操作、capture)
      ui/
        App.tsx                 画面全体。readout / HUD / パネル / トースト / veil
        controller.ts           focusAddress・transitionTo・stageData・品質・安全網・store
      styles.css                artifact の <style> ブロックをそのまま移設(ID・クラス維持)
      main.tsx                  StrictMode なしで App をマウント
    tests/
      core.test.ts              specs/07-verification.md の回帰項目 + 既知の正解値(恒久ゲート)

CORE を単一ファイルに保つ理由: resolve ↔ canonicalChildCount ↔ cellFeatures の相互参照が
多く、ファイル分割は乱数消費順の破壊やモジュール循環のリスクだけを増やす。
分割は必要になった時点の別計画とする。

## マイルストーン

### M1. スキャフォールド
- [x] Vite + React + TS(strict)を初期化。three@0.128.0 を固定インストール
- [x] vitest 導入。`npm run dev / build / test` が動くこと

### M2. CORE 移植
- [x] `src/core/se.ts` へ CORE-BEGIN/END 間を型付けして移植
- [x] DOM / THREE への依存ゼロ(import なし)を確認

### M3. CORE 検証(ゲート)
- [x] specs/07 の回帰項目を tests/core.test.ts に実装(24 テスト)
- [x] 既知の正解値 2 件の一致(contracts §2)
- [x] parity.test.ts: reference から旧 CORE を抽出し、hash プリミティブ・address・
      fingerprint・正規個数・neighborhood・zoomPath・宇宙網列挙・ダストの
      新旧ビット一致を照合(35 テスト全パス。M7 で削除済み)

### M4. render 層移植
- [x] renderer.ts へ R モジュールを逐語移植(定数・ソルト・式は変更なし)
- [x] React からは div ref へのマウントのみ。レンダーループは React 外

### M5. ui 層移植
- [x] styles.css へ <style> を移設、JSX で同一 DOM 構造を再現
- [x] controller.ts へ focusAddress / transitionTo / stageData / candInfo /
      品質 4 段(QUALITIES・perfWatch 降格・コンテキスト喪失時 std 復帰)を移植
- [x] パネル排他・トースト 1.5s・veil 0.28s・手帳ドットの挙動を React で維持
- [x] 起動: initialAddress(DEFAULT_SEED)、Z=4

### M6. 最終検証
- [x] `npm run build` と `npm test` 全通過
- [x] headless ブラウザ(Chromium)による実行時確認:
      起動時 Z=4.00・SCALE=WEB / ホイールで Z 4.00 → −0.25(zMin クランプ)まで
      ズームインし初期惑星に到達、ADDRESS・FP が contracts §2 と一致(ef3eeabe)/
      各ステージで Verify OK / Mark → 手帳 1 件 / Jump プリフィル・互換 address へ
      jump(fp 0136482c・Verify OK)/ 手帳帰還で同一 fingerprint(一周検証)/
      Back で復帰 / DETAIL 巡回(high→xhigh)/ Still 確認パネル経由の有効化 /
      撮影 space-ef3eeabe.png のダウンロード / ページエラーなし /
      スクリーンショットで宇宙網・惑星(縞・環・大気)・銀河(バルジ・腕)の描画確認
- [ ] スマートフォン実機縦画面での操作感・フレームレート確認(ユーザー確認事項)

### M7. クリーンアップ(移植完了後)
- [x] `reference/space-explorer.html` を削除(原本は /Users/taiki/works/ideas/space-explorer/ に現存)
- [x] reference に依存する parity.test.ts を削除(恒久ゲートは core.test.ts の既知の正解値)
- [x] contracts / 本計画 / ソースコメントから reference への参照を整理

## ワークフロー

1. 仕様との差異が必要になった場合は、先に specs / contracts / 本計画を修正し、
   その後にコードを変更する(contracts §5)。
2. 本計画のチェックボックスを進捗として更新する。
3. 移植で発見した artifact 版の不具合は「そのまま移植」を優先し、修正せず
   「発見事項」に記録して別途判断を仰ぐ。

## 発見事項

- artifact 版の不具合は発見されなかった(修正・改変ゼロで移植完了)。
- 観察: Z=−0.25(最接近)では半径の大きいガス惑星(初期惑星を含む)の内部に
  カメラが入り、画面がほぼ暗転して環だけが見える。zMin=−0.25・カメラ距離 3.6 固定
  (specs/40-zoom.md)による artifact 由来の挙動であり、移植でもそのまま保存している。
- three@0.128.0 は型定義を同梱しないため @types/three@0.128.0 を併用した。
