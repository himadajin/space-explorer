# AGENTS.md

space-explorer — 無限の決定論的宇宙を惑星〜宇宙網までズーム探索する Web アプリ
(Vite + React + TypeScript)。本書はエージェント向けの入口であり、真実の源泉は
`docs/internal/` にある。

## まず読む

1. `docs/internal/contracts/porting-invariants.md` — 破ってはならない契約(最重要)
2. `docs/internal/specs/00-overview.md` — 仕様のインデックス(01〜90)
3. `docs/internal/plans/` — 実装計画(1 計画 = 1 ファイル、日付プレフィックス)

## コマンド

- `npm run dev` — 開発サーバー
- `npm run build` — 型チェック + ビルド
- `npm test` — vitest(既知の正解値ゲート)

## 絶対則(詳細は contracts を参照)

- `src/core`(CORE)はビット単位で不変。乱数消費順・分布・32bit 演算を含めて変更禁止。
- three は `0.128.0` に固定。更新は specs/05-art.md の再検証を伴う意図的な決断のみ。
- docs-first: 仕様・挙動に関わる変更は `docs/internal/` の修正 → コード修正の順。
  コードだけが先行して仕様と食い違う状態を作らない。
- seed `7f3e2d` の既知の正解値(`tests/core.test.ts`)が最終判定。CORE・生成系に
  触れたら `npm test` を必ず通す。

## セットアップ補足

`CLAUDE.md` は本ファイルへのシンボリックリンク(Git 管理外)。`npm install` 時に
`prepare` スクリプトが自動生成する。手動で張る場合: `ln -sfn AGENTS.md CLAUDE.md`
