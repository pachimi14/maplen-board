# IMPL_PLAN_vps-trigger — 公式更新の完了を待ってから取得する + VPS から定刻に起動する

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー(2026-08-28)/ 実装: implementer / 統括が検収。
> 関連: LULU-109(①-b)・LULU-139(cron 冗長化)。**①-c(待機役と実行役の分離)は本計画に含めない**。

## 0. 目的と背景

- **北極星への寄与**: **毎朝 JST 9:11 前後にサイトが更新されている**状態を、GitHub のスケジューラの調子に依存せず安定させる。

### 解く問題は2つ

**問題A: GitHub の schedule が遅れる/落ちる**

2026-08-28 は Pages の cron が **8時間遅れ**(04:09Z / 06:04Z 発火 = JST 13:09 / 15:04)、**Retry と Navigator は当日0本**だった。統括が手動 dispatch して `2026-08-27` を救出した。データは失われなかったが、放置ならサイト更新は **JST 13時**だった。

**問題B: 「更新された」の判定が甘く、再構築途中で取りに行って失敗する**

2026-08-12 に本番で発生(LULU-109 に記録済み):

```
Official ranking update detected after 8 probes; settling for 45.0s
Empty ranking page 3, stopping
Ranking API fetch succeeded: 20 characters (level>=225, pages=3)
RuntimeError: Fetched ranking appears stale: changed=20, required=100, baseline=8402
```

公式が JST 9:00 リセット直後の**再構築中**の状態を返し、**1ページ目しか見ていない**現在の判定が「更新完了」と誤認した。fail-closed は正しく働いた(切り詰めデータは非公開)が、**その日の取得は失敗**し、別 cron の救済に依存した。

### 設計方針(ユーザー指摘)

**「失敗させて別系統で拾う」ではなく「再構築が終わるのを待つ」。**

統括は当初 (a) settle 延長 (b) VPS からのリトライ を提案したが、いずれも対症療法だった。

- settle 延長 = 何秒なら十分かの根拠が無い
- 全件取得のやり直し = **約12分(880ページ × 0.8秒)を捨てる**。取りに行く前に待つ方が安い

### 実測(本計画の数値根拠。2026-08-28 に取得)

**1. 公式更新の着地時刻**

直近6日(08-22〜08-27)の run ログで **すべて `detected after 8 probes`**、検知時刻 **00:10:15〜00:10:17Z = JST 9:10:15〜9:10:17**。probe1 が 9:05 開始・45秒間隔なので probe8 = 9:10:15。

→ **公式の更新は JST 9:09:30〜9:10:15 に着地**しており、**6日連続で秒単位の再現性がある**。

**2. API は深いページで再構築の完了を判定できる**(公式 API を直接叩いて確認)

```
page 1     件数=10  先頭level=263   paginationResult.pageCount=133669
page 880   件数=10  先頭level=225   ← ここが埋まっていれば Lv225 の深さまで再構築済み
page 1200  件数=10  先頭level=220
```

再構築中は「3ページ目が空」だった(08-12 実測)。**深いページを1回叩くだけ**で「Lv225 の深さまで完成したか」が判る。**1ページ目の変化だけでは判らない**。

## 1. スコープ

**触るもの(リポジトリ側)**

- `exp_ranking/bot/main.py` — `wait_for_ranking_update` の**判定条件**(取得ループの手前)
- `exp_ranking/bot/config.py` — 新規設定の読み取り
- `.github/workflows/maplen-board-pages.yml` — `RANKING_UPDATE_POLL_TIMEOUT_SEC` の値 / `ENFORCE_JST_FETCH_WINDOW` のゲート / `workflow_dispatch` の入力追加
- テスト

**触るもの(VPS 側・ユーザー作業)**

- systemd service / timer の追加(§4)

**触らないもの**

- **`fetch_ranking_min_level` 本体・リトライ・スキップ判定 = LULU-004(変更禁止)**
- `validate_ranking_freshness`(最後の砦として不変)
- snapshot guard / Release 永続化 / v2シャード復旧 / backup-gdrive
- GitHub の cron 4本 + Retry 5本(**フォールバックとして維持**。LULU-139)
- `timeout-minutes: 330` / `concurrency` / 公開データ契約 / UI

## 2. 設計

### 2.1 判定条件を「2つの AND」にする(問題B)

`wait_for_ranking_update` の成立条件を変更する。

| # | 条件 | 意味 | コスト |
|---|---|---|---|
| ① | **1ページ目の署名が前日と異なる**(既存) | 更新が**始まった** | 1リクエスト |
| ② | **深いページに `RANKING_MIN_LEVEL` 以上のエントリがある**(新規) | 再構築が**完了した** | 1リクエスト |

**両方を満たすまで待ち続ける**。片方でも欠ければ次の probe へ。

**深いページ番号は前日の取得件数から自動決定**する(ハードコードしない。人口増加に自動追随):

```
probe_page = max(2, int(baseline_row_count * 0.9 / API_MAX_PAGE_SIZE))
```

- 0.9 を掛けるのは、当日の人口が前日より僅かに減っても誤判定しないため(10%以上の急減は snapshot guard が別途検出する領域)
- 例: 前日 8,804件 → `int(8804 * 0.9 / 10)` = **792ページ**

**判定**: そのページが **HTTP 200 かつ entries 非空 かつ 最大 level >= `RANKING_MIN_LEVEL`**。

**ベースラインが無い場合(コールドスタート)は ② をスキップ**し、従来どおり ① のみで成立させる(判定材料が無いのに待ち続けて timeout するのを避ける)。

### 2.2 ポーリングのタイムアウト延長

`RANKING_UPDATE_POLL_TIMEOUT_SEC`: **1200(20分) → 2700(45分)**

**根拠(時間予算の検算)**: 最速 cron `7 20` は取得窓まで 238分待機する。

| ポーリング上限 | 合計(待機238 + ポーリング + 取得/出力30) | `timeout-minutes: 330` |
|---|---|---|
| 20分(現行) | 288分 | OK(余裕42分) |
| 30分 | 298分 | OK(余裕32分) |
| **45分(採用)** | **313分** | **OK(余裕17分)** |
| 60分 | 328分 | **NG(余裕2分)** |

→ **`timeout-minutes` を変えずに取れる上限が45分**。通常は JST 9:10 に検知するので実際の消費は約5分で、45分は「再構築が異常に遅い日」のための余裕。

**タイムアウト時の挙動は変更しない**(警告して全件取得へ進み、`validate_ranking_freshness` が最後の砦として stale を弾く)。**待つのは無害だが、待ち続けて何も取らないのは有害**なため。

### 2.3 `workflow_dispatch` でもポーリングを有効化(問題A の前提)

現状 `ENFORCE_JST_FETCH_WINDOW` は **`github.event_name == 'schedule'` のときだけ true** で、`main.py` は待機とポーリングの**両方**をこのフラグで囲っている。よって **VPS から dispatch しても待たずに即取得**してしまい、9:06 起動なら公式更新前(9:10)のデータを掴んで stale で失敗する。

**`workflow_dispatch` に入力 `wait_for_update`(既定 `true`)を追加**し、`ENFORCE_JST_FETCH_WINDOW` を次のようにする。

- `schedule` のとき: **true**(従来どおり)
- `workflow_dispatch` のとき: **`inputs.wait_for_update` が true なら true**
- それ以外(`push`): 従来どおり空

運用:

- **VPS からは既定(待つ)** で叩く
- **緊急の手動救出は `wait_for_update=false`** で即取得できる(取りこぼした過去日を昼間に拾う用途。ベースラインと現在値が既に違うので待つ必要がない)

`force_fetch` 入力は**現状のまま変更しない**(別の関心事)。

### 2.4 VPS から定刻に起動する(問題A の本体)

**VPS の役割は「ボタンを押す」だけ**。取得も DB も Release も GitHub Actions 側のまま。**1日1回・HTTPリクエスト1回**。

- **起動時刻: JST 9:06**(= UTC 00:06)。公式更新の実測着地が JST 9:09:30〜9:10:15 なので、**起動 → runner 起動/セットアップ(約1分) → ポーリング開始 → 9:10 に検知**という流れになる
- **GitHub の cron 4本は残す**。VPS が落ちた日は従来どおり拾う(**多層防御**)
- **二重起動は安全**: 当日取得済みなら Pages 側が `Ranking day ... already captured; skipping` で約20秒で終わる(2026-08-28 に実証済み)

### 2.5 本計画で解決しないこと(明記)

- **GitHub の schedule の遅延・ドロップそのものは直らない**。VPS 経路が主系になることで**回避**するだけ
- **VPS 障害時は GitHub cron 頼みに戻る**(= 現状の品質)
- ①-c(concurrency 占有と「push 静か未デプロイ」窓)は未解決のまま

## 3. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | bot テスト | 全緑(**現状 233 passed, 1 skipped** 以上。新規テスト分の増加は歓迎) | `cd exp_ranking/bot && python -m pytest` |
| 2 | web ビルド | 成功 | `cd exp_ranking/web && npm run build` |
| 3 | workflow YAML | 3本とも構文正常 | `yaml.safe_load` |
| 4 | **再構築中の待機** | **深いページが空の応答で「未完了」と判定し待ち続ける**ことを実証 | 合成テスト(モック) |
| 5 | **完了検知** | 深いページが埋まった応答で**成立して取得へ進む**ことを実証 | 合成テスト |
| 6 | **偽陽性なし** | 1ページ目が前日と同一なら、深いページが埋まっていても**成立しない** | 合成テスト |
| 7 | **コールドスタート** | ベースライン0件のとき ② をスキップし、① のみで成立する | 合成テスト |
| 8 | **probe ページの算出** | 前日 8,804件 → **792**(= `int(8804*0.9/10)`) | 単体テスト |
| 9 | ポーリング上限 | `RANKING_UPDATE_POLL_TIMEOUT_SEC` が **2700** | `grep` |
| 10 | **dispatch でのポーリング有効化** | `workflow_dispatch` に入力 `wait_for_update`(既定 true)があり、true のとき `ENFORCE_JST_FETCH_WINDOW` が true になる | YAML 目視 + パース |
| 11 | **LULU-004 不触** | `fetch_ranking_min_level` / リトライ / スキップ判定 / `validate_ranking_freshness` に **差分0** | `git diff -w -- exp_ranking/bot/main.py` を目視 |
| 12 | **既存経路の不変** | snapshot guard・Release・v2シャード復旧・backup-gdrive・cron 定義に**差分0** | `git diff -w` |
| 13 | **API への追加負荷** | 1 probe あたり **+1リクエスト**のみ(45秒間隔・通常5分で終了 = 実質 +約7リクエスト/日) | 実装の目視 |

### 3.1 本番反映後の観測基準(統括が実測)

| # | 基準 | 目標値 |
|---|------|--------|
| 14 | VPS 経由の起動 | 毎日 **JST 9:06〜9:07** に `workflow_dispatch` の run が作成される |
| 15 | **更新の検知** | 新条件の成立ログが **JST 9:10 台**に出る |
| 16 | **サイト更新時刻** | 公開 v2 の `updatedAt` が **JST 9:35 以前**(現状の良い日と同等以上) |
| 17 | 二重起動の無害性 | 遅れて来た GitHub cron の run が `already captured; skipping` で終了。二重取得0 |
| 18 | 欠測ゼロ | `snapshotDays` が毎日1ずつ増える |
| 19 | 再構築中の待機 | 該当日が来たら、**失敗せず待って取得できている**(`Empty ranking page` からの `RuntimeError` が0件) |

## 4. ユーザー作業(統括・実装担当では実施できない)

> **秘密情報は私に共有しないでください。**

1. **fine-grained PAT を発行**: 対象リポジトリ **`pachimi14/maplen-board` のみ** / 権限 **Actions: Read and write** のみ / 有効期限を記録する(**最長1年で失効する**)
2. **VPS に配置**: PAT を **root のみ読める環境ファイル**(例 `/etc/lulumi/github-dispatch.env`、`chmod 600`)へ。**リポジトリには置かない**
3. **systemd service + timer を作成**(`OnCalendar` は VPS のタイムゾーンに合わせる。UTC 運用なら `*-*-* 00:06:00`、`Persistent=true`)。**既存の sf-history timer と同じ流儀**
4. **PAT 失効の検知**: dispatch の HTTP ステータスが 401/403 のときに気づく手段を用意する(**失効に気づかないと主系が静かに止まる** = 「静かな異常」クラス)

**dispatch の中身**(参考。実装担当はこのスクリプトを `server/` 配下に置き、README に手順を書く):

```bash
curl -sS -X POST -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $GITHUB_DISPATCH_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/pachimi14/maplen-board/actions/workflows/maplen-board-pages.yml/dispatches \
  -d '{"ref":"main","inputs":{"force_fetch":"false","wait_for_update":"true"}}'
```

## 5. 停止条件

- **深いページ判定を `fetch_ranking_min_level` の中に入れないと実現できない**(= LULU-004 抵触)→ 停止・報告
- ポーリング条件の変更が**通常日の検知を遅らせる**(現状 JST 9:10 台に検知できなくなる)
- `timeout-minutes` や `MAX_WAIT_SEC` を変えないと成立しない構成になった
- 公式 API への追加リクエストが 1 probe あたり1回を超える設計しか作れない
- スコープ外のファイルを触る必要が生じた

## 6. コミット分割(単独 revert 可)

1. **深いページ判定の追加**(`main.py` の `wait_for_ranking_update` + `config.py`)+ テスト — **workflow 未配線 = 挙動不変**
2. **ポーリング上限 1200→2700** + **dispatch でのポーリング有効化**(workflow の env と入力)= **挙動変更の本体**
3. **VPS 用の dispatch スクリプトと手順書**(`server/` 配下 + README)— **リポジトリ内は文書とスクリプトのみで本番影響なし**

## 7. 検証コマンド

```
cd exp_ranking/bot && python -m pytest
cd ../web && npm run build
python -c "import yaml;d=yaml.safe_load(open('.github/workflows/maplen-board-pages.yml',encoding='utf-8'));print([c['cron'] for c in d[True]['schedule']]);print(list(d[True]['workflow_dispatch']['inputs'].keys()));print(d['jobs']['build'].get('timeout-minutes'))"
grep -n 'RANKING_UPDATE_POLL_TIMEOUT_SEC\|ENFORCE_JST_FETCH_WINDOW' .github/workflows/maplen-board-pages.yml
git diff -w -- exp_ranking/bot/main.py
git diff -w --stat
```

**改行コードノイズ混入禁止**: `git add -A` は使わず、触ったファイルのみ個別 add。

## 8. ロールバック

- コミット2 を revert すれば**判定条件は新しいまま、ポーリング上限と dispatch ゲートだけ元に戻る**。
- コミット1 を revert すれば判定条件も元(1ページ目のみ)に戻る。
- **データ破壊の経路が存在しない**: 取得ロジック・DB・v2・Release に差分0。`validate_ranking_freshness` を残すので、最悪でも「取得に失敗する」までで、汚れたデータは公開されない。
- VPS 側は timer を止めれば GitHub cron 単独の現状に戻る。

## 9. 完了報告テンプレ

- 実施コミット(3分割のハッシュ):
- 受け入れ基準 §3 の 1〜13 の実測値:
- **`git diff -w -- exp_ranking/bot/main.py` の全文**(LULU-004 不触の証明):
- 新規テストの一覧と、それぞれが §3 のどの基準に対応するか:
- **未push・本番未反映の明示**:
- 残課題・watch-item:
