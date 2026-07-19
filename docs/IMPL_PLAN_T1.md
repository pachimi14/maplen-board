# IMPL_PLAN_T1 — bot エクスポート拡張(順位変動・職業内/サーバー内順位の追加)

> 1計画書=1縦切りテーマ(PR-001)。承認者: ユーザー(設計承認済み 2026-07-14、実データ検証で契約確定=LULU-013) / 実装: implementer
> **T1 はデータ契約の先行固定。web は触らない(bot のみ)。**

## 0. 目的と背景

- 北極星への寄与: 各キャラの「ランキングでの立ち位置(順位変動・職業内/サーバー内順位)」を bot 側で事前計算して JSON に持たせ、web(T3/T4)と静的個別ページ(T6)が同じ数値を再計算なしに使えるようにする。
- 参照決定: DECISION_LOG **LULU-013**(契約)/ LULU-004(取得ロジック変更禁止)/ PR-003(データ契約変更は事前承認済)/ PR-004(フィクスチャ駆動)
- 正の所在: 派生順位の**正は `mvp_export.py` に一本化**。web は将来消費のみ(再計算しない)

## 1. スコープ

### 触るファイル
- `exp_ranking/bot/mvp_export.py` — `build_mvp_characters`(と必要なら小ヘルパ)に順位フィールド追加
- `exp_ranking/bot/test_mvp_v2.py`(または新規 `test_rank_fields.py`)— フィクスチャテスト追加

### 触ってはいけないファイル
- `main.py`(取得/リトライ/スキップ)= 変更禁止(LULU-004)
- `sqlite_storage.py` / `models.py` / `analysis.py` / `identity.py` / `ranking_periods.py` / `level_exp.py` = **取得・保存・既存分析ロジックは変更しない**(読むだけ)。`SnapshotRow.rank_fluctuation` は既存フィールドをそのまま利用
- web 一式 = 対象外(T1では触らない)
- CI ワークフロー = 対象外

## 2. 追加する契約(character 各要素に付与)

`build_mvp_characters` が返す各 character dict に以下を追加。**v1 `rankings.json` と v2 summary の両方に自動的に乗る**(build_v2_payloads は history 以外を透過コピー)。

| フィールド | 型 | 定義 | null 条件 |
|---|---|---|---|
| `rankFluctuation` | int | **既存 API 値をそのまま**(`latest.rank_fluctuation`)。正=上昇/負=下降/0=変動なしor新規 | なし(既定0) |
| `previousRank` | int\|null | latest_date−1暦日のスナップショットにおける当該 identity の `rank` | 前日スナップショット不在 or その日当該キャラ不在 |
| `jobRank` | int\|null | 整形済み `job` 完全一致グループ内のレベル順位(1始まり) | `job` 欠損 |
| `jobRankTotal` | int\|null | その職業グループの人数 | `job` 欠損 |
| `worldRank` | int\|null | `worldId` 一致グループ内のレベル順位 | `worldId` 空 |
| `worldRankTotal` | int\|null | そのサーバーの人数 | `worldId` 空 |

### 算出規則(明文化)
- **採番**: `rank` 昇順の単純連番(1,2,3…)。`rank` は日次で一意(実証: 重複0/7004)。**安定ソートキーは `(rank, historyKey)`**(rank一意のため historyKey は決定性のための保険)
- **全人口で計算 → その後 export_top_n を適用**。本番は export_top_n=None(全体)だが、正しさのため truncation 前に計算する
- **previousRank の identity 照合**は既存の `resolve_snapshot_identity`(asset_key 優先)経由のグルーピングに従う=**改名耐性**。前日へは1暦日だけ遡る(直近成功日へは遡らない)
- **null は例外を投げない**: job/world 欠損は該当キャラのみ null にし、**エクスポート全体を停止させない**
- **未知 worldId を仮グループ化しない**(空は null、そのまま)

### 据え置き
- `dataFormatVersion` = **2 のまま**(追加のみ=後方互換)。web の履歴ロードは `dataFormatVersion !== 2` でシャード取得をゲートしているため bump 禁止

### UI 消費契約(将来 T3/T4 が守る。T1 では web を触らないが契約として明記)
`rankFluctuation` は「比較可能」であることを保証しない。**表示ロジックは `previousRank` を先に見る**:

```
previousRank === null
  → 新規/前日比較不能の表示(rankFluctuation===0 でも「変動なし」と解釈しない)
previousRank !== null && rankFluctuation > 0   → 順位上昇
previousRank !== null && rankFluctuation < 0   → 順位下降
previousRank !== null && rankFluctuation === 0 → 順位変動なし
```

- 責務: 数値表示=`rankFluctuation` / 比較可能性=`previousRank` / 比較不能判定=`previousRank === null` / 厳密差分=利用側で `previousRank − rank`(JSON に重複保存しない)
- 「新規」と「前日取得スキップ」は `previousRank === null` だけでは区別しない。T1 では**共通の「前日比較データなし」状態**で扱う。区別が必要になったら別フィールドを設計(今は作らない=作らないリスト)

## 3. 変わってよいもの・いけないもの

- 変わってよい: 上記6フィールドの**追加**のみ
- 変わってはいけない: 既存の全フィールドの**値・型・キー名**(v1/v2 とも)、履歴(history/シャード)の形式・内容、meta の既存項目、取得・保存ロジック、シャード分割方式

## 4. 受け入れ基準(数値・テスト)

| # | 基準 | 目標 | 測定 |
|---|------|------|------|
| 1 | bot テスト | **全緑** | `cd exp_ranking/bot && python -m pytest` |
| 2 | 既存フィールド不変 | v1/v2 の既存キーの値・型が変化なし | 既存テスト全緑 + 新規テスト#10 |
| 3 | エクスポート時間増 | 無視可能(O(N log N), N≈7431) | 概算(要実測・停止条件で監視) |

### 追加フィクスチャテスト(PR-004: 外部API非依存・手計算値と独立照合)
1. 複数 job・複数 world 混在データで、job/world が**それぞれ独立に**採番される
2. **入力順を入れ替えても結果が同一**(安定ソート)
3. `export_top_n` 対象外のキャラを含む全人口で `jobRankTotal`/`worldRankTotal` が正しい(=truncation 前計算の担保)
4. 前日スナップショット**自体が存在しない**日 → previousRank=null(全員)
5. 前日スナップショットは在るが**対象キャラのみ不在** → そのキャラ previousRank=null
6. 同一キャラの照合キーが**改名の影響を受けない**(asset_key 一致で前日照合)
7. `rankFluctuation` は**既存 API 値がそのまま出力**される(加工しない)
8. `worldId` が None・空文字・欠損 → worldRank/worldRankTotal=null(仮グループ化しない)
9. **入力データ(snapshots/analysis)を変更せず、出力へのフィールド加算のみ**
10. **v1・v2 双方で既存フィールドの値・型が不変**(順位上昇/下降/横ばい、null 各系を含む小データで)
- 加えて: 順位変動の符号(上昇=正/下降=負/横ばい=0)、job 欠損 → jobRank=null かつ**例外を投げない**

## 5. 停止条件(該当したら実装を止め、選択肢+推奨付きで報告)

- 全人口での順位計算が既存の build 構造(sort→truncate 順序)と構造的に整合しない
- previousRank が実データで大量に null になり「前日」定義の見直しが要る(想定外の取得スキップ頻度)
- 既存フィールドの値・型を変えずに追加できない事情が判明
- スコープ外ファイル(main.py 等)の変更が必要になった

## 6. コミット分割(挙動不変先行・各コミット単独 revert 可)

1. `rankFluctuation`(既存API値のパススルー)+ `previousRank` を追加 + テスト
2. `jobRank`/`jobRankTotal`/`worldRank`/`worldRankTotal` を全人口計算で追加(truncation 前)+ テスト
3. (必要時)ヘルパ整理

## 7. 検証コマンド

```
cd exp_ranking/bot && python -m pytest          # 全緑
cd exp_ranking/bot && python -m pytest test_mvp_v2.py -q   # 既存 v2 契約の非回帰
git diff -w -- exp_ranking/bot/mvp_export.py exp_ranking/bot/test_*.py
```

Web は触らないため npm build 不要。実データでの目視は任意(統括が run_local_dev.bat 相当で v2 に新フィールドが乗るか確認可)。

## 8. ロールバック

- 各コミット単独 revert 可。フィールド追加のみのため revert しても既存 web・既存契約は無傷(web は未知フィールドを無視)。

## 9. 完了報告テンプレ

- 実施コミット(ハッシュ・件名)
- 受け入れ基準の実測(pytest 結果、既存テスト非回帰、エクスポート時間の概算/実測)
- 追加フィールドのサンプル(実データ or フィクスチャで character 1件の6フィールド)
- テスト#1〜#10 + 符号/例外テストの結果一覧
- 残課題・watch-item(特に previousRank の null 率など実データ観測)
