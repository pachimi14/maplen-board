# SH2_BACKFILL — 履歴 SQLite スキーマ + 再開可能バックフィル 結果報告

計画書: `docs/IMPL_PLAN_SH2.md`。設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2 → 統括が本スライスの
実測を受けて §2.1/§2.2/§9.1 を訂正済)。実行場所: メインPC(設計 §5.3 どおり)。

再実行コマンド:
```bash
cd server/sf-history
python scripts/gen_item_list.py
python scripts/backfill.py --db data/sf_price_history.sqlite --limit 120   # 繰り返し実行(再開可能)
python scripts/audit_high_star_plateau.py --out ../../docs/reports/sh2_audit_high_star_plateau.json
python -m pytest tests/
```

---

## 実行方法についての申し送り(統括からの介入)

初回はバックグラウンド実行(`python scripts/backfill.py &`)で開始したが、統括から**「バックグラウンド実行は
使わないでください」**との指示を受けた。バックグラウンドのプロセス自体は実際には生きて進行を続けていた
(統括が観測した「既に終了」は統括セッション側の見え方の話で、プロセスは実際には停止していなかった)が、
指示に従い当該プロセスを `taskkill /F` で明示的に停止し(直前のコミット済み行はすべて残る。
`upsert_hourly_rows`/`record_progress` は combo 単位で即コミットされるため損失なし。`PRAGMA integrity_check` = `ok`
で確認済み)、以降は**前景実行 + `--limit 120`(1チャンク約2.5分)を繰り返す方式に切り替えて完走させた**。
これは受け入れ基準 (d) の再開実証をそのまま兼ねる(下記)。

---

## (a) 対象装備リスト

`python scripts/gen_item_list.py` → `data/sf_history_items.json`(コミット対象)。

- `items`: **28件ちょうど**
- `excluded`: **2件**(`1113282` Noble Ifia's Ring / `1122254` Mechanator Pendant)
- `sourceCommit`: `a9f534b4d1292fd580780a22344198f46027ae38`(maplenEnhancebot HEAD、生成時点)

**除外理由についての申し送り**: 設計書 §7 / 計画書 §4 は「除外は原案どおり」とだけ記し、除外の実質的な理由を
本リポのコミット履歴からは追跡できなかった(該当する「原案」テキストが見つからない)。JSON の `reason` は
実装担当が実測から再構成した根拠(この2件は maplenEnhancebot の priority 代表30件のうち唯一
`RANGE_118_TO_127` 帯であり、他28件はすべて `RANGE_128_TO_137` 以上。maplenEnhancebot 内でも
`EXTRA_PRIORITY_GROUPS`(SNAP-1 S0 タグ)による手動オーバーライドでのみ priority 集合に入っている)であり、
**統括が把握している本来の理由と異なる可能性がある**。確認をお願いしたい。

生成スクリプトは `sys.dont_write_bytecode = True` を import 前に設定しており、maplenEnhancebot に
`__pycache__/*.pyc` を書き込まないことを実行前後の `git status --short` の行数不変(18行のまま)で確認した。

---

## (b) バックフィル進捗

`sf_history_backfill_progress`: **`status='done'` が 616/616**(28×22)。**`status='error'` は 0件**。
失敗した組み合わせ・列挙するものなし。

行 `row_count=0` で `done` になった組み合わせが **12件**(6装備 × ☆20/☆21)ある。これはエラーではなく、
公式 API がその (item, itemUpgrade) について HTTP 200 で空の `points` を返した(=市場にその星までの
強化実績が本バックフィル対象期間に一件も無い)実データであり、§9.1 の欠損規約(`requiredPriceStars` が
揃わない時点は `null`)がそのまま吸収する:

| itemId | 装備名 |
|---|---|
| 1022232 | Black Bean Mark |
| 1032241 | Dea Sidus Earring |
| 1072972 | Royal Von Leon Warrior Boots |
| 1082613 | Royal Von Leon Warrior Hands |
| 1102713 | Royal Von Leon Warrior Cape |
| 1212102 | Royal Von Leon Glorier |

いずれも RANGE_128_TO_137 帯(旧世代コンテンツ)の装備で、☆20/☆21 は共通して空。

---

## (c) hourly 総行数

**2,254,103 行**。見積り(28×22×約3510=2,162,160)との比 **104.25%**(±10% 以内)。

行数の実測分布(★詳細は (P1 訂正) 参照。見積りより多いのは 200日要求より160日要求の方が
多くのデータを返すという実測結果と整合する):

| row_count | combo 数 |
|---|---|
| 3753 | 491 |
| 3754 | 38 |
| 3510 | 12 |
| 0(空。上記12件) | 12 |
| その他(星ごとに開始時刻が違うため短い系列) | 63 |

---

## (d) 再開の実証

初回バックグラウンド実行を統括の指示で中断(`taskkill /F`)した後、**前景 `--limit 120` を繰り返す**方式に
切り替えて完走させた。各チャンクの「開始前の残り件数」と「そのチャンクのリクエスト数」:

| チャンク | 開始前の残り件数(616 − 完了済み) | `--limit` | 実際のリクエスト数 | 一致 |
|---|---|---|---|---|
| (中断前・バックグラウンド区間) | 616 | — | 202(中断時点までに完了) | — |
| 1回目(前景) | 414 | 120 | **120** | ✅ |
| 2回目(前景) | 294 | 120 | **120** | ✅ |
| 3回目(前景) | 174 | 120 | **120** | ✅ |
| 4回目(前景・最終) | **54** | 120 | **54** | ✅(**残り件数 < limit を正しく検出**、余分なリクエストをしなかった) |

4回目が最も厳密な実証: `--limit 120` を指定したにもかかわらず、DB の `status='done'` から残り54件のみを
正しく検出し、**リクエスト数がちょうど54で止まった**(120にはならなかった)。これは
`sf_history_backfill_progress` を都度読み直して skip する実装が正しく機能していることの直接証拠。

pytest 側でも同じロジックを `test_backfill_resumability_second_run_only_fetches_remaining` としてオフラインで
機械検証している(44件中10件処理 → 2回目に残り34件だけ処理、リクエスト数が正確に34件と一致することを assert)。

---

## (e) 重複

```sql
SELECT COUNT(*) - COUNT(DISTINCT item_id||'/'||item_upgrade||'/'||price_at) FROM sf_price_history_hourly;
```
→ **0**

---

## (f) DB ファイルサイズ

**275.2 MB**(288,616,448 バイト、WAL チェックポイント後)。300MB 未満で基準内。

設計 §5.3.1 の見積り「150〜200MB」よりやや大きいが、行数自体は見積り比 104% とほぼ一致しており、
差の主因は **1行あたりの実サイズ**(`price_at`/`fetched_at` の2列がいずれも ISO8601 文字列で
1行あたり約128バイト)であり、行数の異常な超過ではない。`PRAGMA integrity_check` = `ok`。

---

## (g) 総リクエスト数 / 429

- **総リクエスト数: 616**(= `done` 616件、各combo 1リクエストのみ。リトライ・再試行は一度も発生していない)
- **429: 0件**
- 内訳: バックグラウンド区間 202件(全て200、ログ実測で429出現0件を確認)+ 前景4チャンク 120+120+120+54=414件 = 616件

---

## (h) ★§9.2 ☆20/☆21 同値判定(本スライスの重要な成果物)

`scripts/audit_high_star_plateau.py`(出力全文 `docs/reports/sh2_audit_high_star_plateau.json`)。

- **完全一致した装備: 0 / 28**
- **不一致だった装備: 22 / 28**(共通時点はあるが1点以上ズレる)
- **☆20/☆21 のどちらか(または両方)が空で比較不能: 6 / 28**(上記 (b) の6装備。両系列とも0点のため
  `noOverlap=true` として別枠。「不一致」ではなく「比較不能」)

不一致22装備の**一致率**(共通点数のうち値が一致した割合。降順・全件):

| itemId | 装備名 | 共通点数 | 不一致点数 | 一致率 |
|---|---|---|---|---|
| 1212115 | AbsoLab Shining Rod | 3754 | 73 | 98.1% |
| 1332225 | Fafnir Damascus | 3754 | 111 | 97.0% |
| 1382265 | Arcane Umbra Staff | 3504 | 251 | 92.8% |
| 1082637 | AbsoLab Mage Gloves | 3753 | 407 | 89.2% |
| 1152176 | AbsoLab Mage Shoulder | 3753 | 532 | 85.8% |
| 1082698 | Arcane Umbra Thief Gloves | 3662 | 523 | 85.7% |
| 1073035 | AbsoLab Pirate Shoes | 3753 | 540 | 85.6% |
| 1132272 | Golden Clover Belt | 3753 | 552 | 85.3% |
| 1102940 | Arcane Umbra Knight Cape | 3490 | 572 | 83.6% |
| 1102775 | AbsoLab Knight Cape | 3753 | 658 | 82.5% |
| 1003797 | Royal Warrior Helm | 3753 | 685 | 81.7% |
| 1073160 | Arcane Umbra Archer Shoes | 3496 | 669 | 80.9% |
| 1022277 | Papulatus Mark | 3753 | 717 | 80.9% |
| 1003720 | Chaos Von Bon Helmet | 3753 | 734 | 80.4% |
| 1113313 | Guardian Angel Ring | 3753 | 765 | 79.6% |
| 1042257 | Eagle Eye Assassin Shirt | 3753 | 800 | 78.7% |
| 1082297 | Falcon Wing Sentinel Gloves | 3753 | 807 | 78.5% |
| 1122150 | Dominator Pendant | 3753 | 862 | 77.0% |
| 1102276 | Dragon Tail Mage Cape | 3753 | 938 | 75.0% |
| 1072485 | Lionheart Battle Boots | 3753 | 1249 | 66.7% |
| 1152108 | Lionheart Battle Shoulder | 3753 | 1377 | 63.3% |
| 1012757 | Twilight Mark | 3525 | 1880 | 46.7% |

**事実として観測できること(判断はしない)**:
- **「完全一致(plateau)」は全装備で成立しない**。SH-1 の1装備・1スナップショットで見えた「☆20=☆21」は、
  少なくとも時系列全体で見ると恒常的な現象ではない
- ただし**部分的な一致は非常に高頻度**に起きている(全22装備が一致率75%以上、うち3装備は92%超)。
  「時々☆20と☆21が同じ値になる」ことは実際に頻発しており、SH-1が観測した1時点の一致が偶然とは言い切れない
- **一致率には装備間で明確な傾斜がある**: RANGE_200_TO_209 帯の武器3種(AbsoLab Shining Rod / Fafnir Damascus /
  Arcane Umbra Staff)が突出して一致率が高い(92〜98%)一方、それ以外は63〜85%に分布し、
  Twilight Mark(装身具・NORMAL帯)が最も低い(46.7%)
- **設計書 U6 の (a)/(b) いずれかを本スライスの実装担当が断定することはしない**(計画書 §7 の停止条件注記
  どおり、判断は統括に委ねる)

---

## (i) pytest

**25 passed**(オフライン。ネットワークを叩くテストなし。`gen_item_list` 関連4件のみ、実在する
maplenEnhancebot ディレクトリに依存する統合テストとして `skipif` ガード付きで実装 -- このマシン以外では
自動的にスキップされる)。

```
25 passed in 0.61s
```

---

## (j) git status に sqlite が無いこと

```
$ git status --short --ignored server/sf-history/
?? server/sf-history/
!! server/sf-history/.pytest_cache/
!! server/sf-history/__pycache__/
!! server/sf-history/data/sf_price_history.sqlite
!! server/sf-history/scripts/__pycache__/
!! server/sf-history/tests/__pycache__/
```

`.sqlite` は `!!`(ignored)であり、`git add` の対象にならないことを `git add --dry-run` でも確認済み。

---

## (k) `npm run build`

```
cd exp_ranking/web && npm run build
✓ 2363 modules transformed.
✓ built in 5.05s
```

緑(web を触っていないことの確認)。

---

## 停止条件に触れた事項

該当なし。ただし運用面で1点: **バックグラウンド実行から前景チャンク実行への切り替え**(統括の明示指示)。
理由は本報告の冒頭「実行方法についての申し送り」を参照。データの損失・重複は発生していない
((e) 重複0・整合性チェック `ok` で確認済み)。

## 設計書との矛盾(自分では直さず、ここに書く)

統括がすでに `docs/DESIGN_SF_COST_HISTORY.md` §2.1/§2.2/§9.1 を本スライスの実測に基づき訂正済み
(実装担当のバックフィル実行中に統括が並行してデータを検分し、下記2点を反映)。本報告では実装担当側が
独立に確認した数値として重複記載する(数値は一致している):

1. **P1(保持期間150日)は誤りだったことが確定した**。160日窓を要求したところ **3753点**(最古
   `2026-02-25T19:00:00Z` = 要求窓の端ちょうど)を得られ、SH-1 が200日窓で得た3510点(最古149.7日前)より
   **多い**。「窓を広く要求するほど多く返る」という前提が成り立たず、**200日要求は160日要求より少ないデータ
   しか返さなかった**。保持期間は少なくとも160日ある。統括の指示により、**真の保持期間を追加調査すること
   はしていない**(表示要件150日には現状の160日窓で十分な余裕があるため)。
2. **`item_id=1012757`(Twilight Mark)は星ごとに最古時刻が6種類に割れている**(最短系列は
   `itemUpgrade=21` で3525点、最古 `2026-03-07T10:00:00Z`)。「同一装備なら全星が同じ期間そろう」という
   仮定は置けないことが実データで確認された。§9.1 の欠損規約(`requiredPriceStars` が揃わない時点は `null`)
   がそのまま吸収するため、本スライスでのスキーマ・ロジック変更は行っていない。

## 気づいたが本スライスでは扱わなかったこと

- **除外2件の理由の出典**((a) 節を参照)。実装担当が再構成した根拠が正しいか、統括の確認を仰ぎたい
- `row_count=0` の12組み合わせ(6装備 × ☆20/☆21)は、SH-3 の4h導出・SH-5のチャート実装時に
  「その装備のその星は最初から空」という自明のケースとして扱われるはず(§9.1 の欠損規約で吸収されるが、
  念のため申し送り)
- DB サイズが見積り上限(200MB)をやや超えた実測理由((f) 参照)。300MB の停止閾値には遠く、対応不要
- (h) の一致率の装備間傾斜(武器種で高い)は面白い観察だが、本スライスの範囲外(U6 の裁定材料として提供のみ)
