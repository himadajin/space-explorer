# 60 — ui / state: 探索状態、HUD、手帳、品質、撮影

UI は最後まで最小限であり、主役は宇宙である [方式]。ラベルは短い英語のみ。永続化は存在せず、状態の持ち越しは address 文字列の copy と jump だけで成立する。

## 探索状態

    state = {
      addr, addrStr        // focus 対象(パスの真実、最深 address)とその正規文字列
      anchors              // zoomPath の 5 anchor(null 許容)
      data                 // ステージごとの表示データ(desc, addrStr, children, focusedAddrStr, dust)
      viewStage            // いま見ているステージ(Z に最も近い非 null ステージ)
      viewAddrStr, viewDesc// HUD が表示・操作する対象(= 表示中スケールの anchor)
      prevAddrStr          // 一段だけの back
      bookmarks[]          // { a, fp, code, kind, colorCss }
    }

Z(および目標値)とカメラ姿勢は render 層が保持する。view 追従の規則: mainStage = |j − Z| 最小の非 null ステージ。ズームアウトすると ADDRESS / FP / SCALE の表示は親の anchor に切り替わり、Mark・Verify・copy はその表示対象に対して作用する。

## focus と遷移

focusAddress(addr, {z?, noHistory?}) は、履歴(prevAddrStr)更新 → zoomPath → stageData → buildSky → buildStages(z 省略時は focus の kind のステージ)→ view 同期、の順で全ステージを再構築する。transitionTo は 290ms の暗転(veil)を挟んで focusAddress を呼ぶ。パス上の対象(anchors のどれか)を選んだ場合は再構築せず R.setZ(そのステージ) のイージングのみで移動する。

タップ選択(pick): 命中対象の addrStr がパス上なら setZ、そうでなければ符号トースト(→ P-XXXX)を出して transitionTo(kind のステージへ)。

## HUD

上部左: SEED、SCALE(表示中 anchor の kindLabel 大文字)。上部右: 手帳の点の列と件数(✧ n)。

下部バー(常設。折りたたみパネルは存在しない):

    ADDRESS 行  … 表示中 anchor の address。タップで copy
    メタ行      … FP 値、✓(verify)、検証結果、右端に Z 値
    ボタン行    … ✧ Mark / ↑ Up / ← Back / ⌖ Jump |spacer| DETAIL 値 / Still / ◉ 撮影

- Mark: 表示中対象を手帳へ登録/解除(登録済みなら ✦ 表示)。
- Up: 表示中ステージより上の最初の非 null ステージへ setZ。最上位で無効。
- Back: 直前の focus address へ transitionTo(一段のみ。履歴の自動記録はしない)。
- Jump: 入力パネル(現在の viewAddrStr をプリフィル)。パース失敗は理由を表示。成功で transitionTo。
- Verify: viewAddrStr を再パース → resolveFresh(キャッシュ非経由)→ fingerprint と正規形の一致を検査し、OK · regenerated {fp} / MISMATCH を表示。
- パネル(jump / notebook / paste / still 確認)は同時に 1 つ。開閉アニメーションは 0.16s。

## 手帳(ブックマーク)[方式]

ブックマークは座標であってセーブデータではない。内部は {address, fingerprint} 相当の配列以上を持たず、閉じれば消える。持ち帰りはテキスト書き出しでユーザーの手帳(メモアプリ)へ委ねる。

- 登録: 表示中対象に ✧ を 1 タップ。符号は kind 頭文字 + "-" + fingerprint 先頭 4 桁大文字(例 P-7A3F)。色片は対象の基礎色。
- 一覧: 右上の点の列(直近 8 件の色点、登録時にスケールインのアニメーション。再描画は内容変化時のみ)。タップでドロワー。各行は色片 + 符号 + 種別 + 削除 ×。行タップで帰還(パス上なら setZ、他は transitionTo)。
- ⧉ Copy all: 全 address を改行区切りで copy。＋ Paste: 貼り付けテキストを行ごとにパースし、正規形で重複排除して復元(n added / invalid 件数を通知)。
- 自由な命名と訪問履歴の自動記録は存在しない(ADR-4)。

clipboard は navigator.clipboard を試み、失敗時は一時 textarea + execCommand にフォールバックする。

## 品質(DETAIL)と still

    QUALITIES = [ std ×1 px2 | high ×2 px2 | xhigh ×4 px2 | still ×8 px3 ]
    初期値: ポインタが coarse(タッチ主体)なら std、それ以外 high

mult は表示密度(ダスト試行数、空・銀河の点数、still の追加層・高解像度テクスチャ)にのみ作用する。DETAIL ボタンは std → high → xhigh を巡回し、still からのタップは std に戻る。still は巡回に含まれず、Still ボタン → 確認パネル(Heavy load. May be unstable on some devices.)→ ↵ で有効化する意図的な操作である。still 中は Still ボタンがアクティブ表示になり、再タップで std へ戻る。品質変更は veil(「rendering」表示)を挟んで全再構築する。

安全網:

- 性能監視: xhigh / still への切替後、25 フレーム捨てて 90 フレームの平均フレーム時間を測り、90ms 超なら一段下げて Detail lowered · performance を通知。
- コンテキスト喪失: webglcontextlost を preventDefault で受け、restored で std に再構築し Detail reset · graphics recovered を通知。still がどれだけ攻めても最悪の着地は std である。

## 撮影(◉)

1 フレームだけ pixelRatio を max(現在値, min(4, 4096/長辺 CSS px)) に引き上げて描画し、toDataURL("image/png") で読み出して <a download> で保存する(ファイル名 space-{fingerprint}.png)。sizeAttenuation:false の点(空の星)はデバイスピクセル単位のため、撮影倍率ぶんサイズを一時補償し、見た目を保ったまま解像度だけ上げる。撮影後は元の解像度へ復帰して再描画。失敗時は Capture failed をトーストする。サンドボックスがダウンロードを禁じる環境では保存されないことがある(既知の制約)。

## 起動

起動時の focus は initialAddress(DEFAULT_SEED)(10-identity.md)、初期 Z は 4(宇宙網)。開いた瞬間に大規模構造の中におり、ズームインは代表降下をたどって初期惑星に至る。

## その他の入出力

キーボード: 矢印 = 回転、+/− = Z。reduced-motion 環境では慣性を無効化し、Z イージングをほぼ即時にする。トーストは 1.5 秒。veil は 0.28s のフェード。
