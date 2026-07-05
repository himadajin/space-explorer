# 実装計画 — GitHub Actions による CI/CD と GitHub Pages ホスティング

- 日付: 2026-07-05
- 状態: 実装中
- 目的: main への push を契機に build + test を自動実行し、成功時に
  GitHub Pages (https://himadajin.github.io/space-explorer/) へ自動デプロイする。
  挙動・見た目・three@0.128.0 固定など既存の不変条件には一切触れない。
- 正とする文書: `docs/internal/contracts/porting-invariants.md` §3(three 固定)は
  変更しない。本計画はインフラのみを対象とし、CORE/render/UI の契約とは独立。
- 備考: これはプロジェクトページ(himadajin/space-explorer)であり、
  Pages の URL はリポジトリ名のサブパスを含む
  (https://himadajin.github.io/space-explorer/)。vite.config.ts の base
  設定が必須(未設定だと資産パスが 404 になる)。

## 成果物の構成

    vite.config.ts                  base をビルド/プレビュー時のみ "/space-explorer/" に
    .github/
      workflows/
        ci-deploy.yml                build+test を main・develop への push と全 PR で実行し、
                                      main への push のみ deploy ジョブへ進む単一ワークフロー
    docs/internal/plans/
      2026-07-05-github-actions-pages.md   本ファイル

## マイルストーン

### M1. vite.config.ts の base 対応
- [x] `defineConfig(({ command, isPreview }) => ...)` 形式に変更し、
      command === "build" || isPreview の場合のみ base を "/space-explorer/" に、
      それ以外(npm run dev)は "/" のままにする
- [ ] `npm run build` 後、dist/index.html の asset パスが
      `/space-explorer/assets/...` になっていることを確認
- [ ] `npm run preview` で `/space-explorer/` 配下として動作することを確認

### M2. ワークフロー追加
- [x] `.github/workflows/ci-deploy.yml` を新規作成
- [x] build-and-test ジョブ: checkout → setup-node(22, cache: npm) → npm ci →
      npm test → npm run build
- [x] deploy ジョブ: build-and-test に依存、main への push イベントの時のみ実行、
      configure-pages → upload-pages-artifact(path: dist) → deploy-pages
- [x] permissions ブロック(pages: write, id-token: write)と
      environment: github-pages を設定
- [x] トリガーは main・develop への push と全 PR(build-and-test)、
      デプロイは main への push のみ

### M3. リポジトリ設定(手動・ユーザー確認事項)
- [ ] GitHub上で Settings → Pages → Source を「GitHub Actions」に変更
      (このリポジトリでは自動化不可、ユーザーが1回だけ手動操作する)

### M4. 検証
- [ ] cicd ブランチで workflow_dispatch により手動実行し、build-and-test が
      通ることを確認(この時点では main でないため deploy はスキップされる想定)
- [ ] main へのマージ後、Actions タブでワークフロー成功を確認
- [ ] https://himadajin.github.io/space-explorer/ にアクセスし、
      3D シーンが描画されること・コンソールに 404 が出ていないことを確認

## ワークフロー

1. 本計画のチェックボックスを進捗として更新する。
2. three@0.128.0 やその他の依存バージョンは一切変更しない
   (contracts §3 は本計画の対象外だが遵守する)。
3. package-lock.json の内容以外の依存解決(npm install での上書き等)を
   CI に持ち込まない。CI は必ず `npm ci` を使う。

## 発見事項

- package-lock.json は存在するため `npm ci` がそのまま使える。
- three のバージョン固定(contracts §3)は本計画のいかなるステップでも
  変更しない。CI が package-lock.json 経由でインストールする限り自動的に守られる。
- Node バージョンはリポジトリに `.nvmrc` も `engines` も未指定だったため、
  本計画で Node 22 を新たに採用し、CI (`actions/setup-node`) にのみ明示する
  (`.nvmrc` の追加は任意、必須ではない)。
- GitHub Pages の Source を「GitHub Actions」に切り替える手動設定は
  コード変更では自動化できず、ユーザーが GitHub の Web UI で一度だけ行う。
