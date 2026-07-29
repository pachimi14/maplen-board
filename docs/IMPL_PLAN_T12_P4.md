# IMPL_PLAN_T12_P4 — v1 `rankings.json` の完全廃止(生成停止 + 配信停止 + 復旧経路の撤去)

> `docs/IMPL_PLAN_T12.md` の **P4**(scope ⑤⑥)。1計画書=1縦切りテーマ(PR-001)。
> 承認者: ユーザー / 実装: implementer / 統括が code-review+実測で検収。
> 前提: **P3 完了**(出血停止・Release が耐久層・v2シャード層 有効化。実測で db.gz コミット0件・リポ増加+40KB/24h)。

## 0. 目的と背景

- **要件を一文で**: **旧 v1 `data/rankings.json`(約62MB)の生成・配信・復旧利用をすべて止め、データ経路を v2 に一本化する。**
- **なぜ今か**: LULU-015 で「v1 の廃止は **v2+シャード復旧への移行とセット**」と決めた。その前提は **P1/B'(LULU-062②)で v2シャード復旧が全374,121点ビット完全一致・過大0**、**P3 で v2 層を有効化**したことで**充足済み**。
- **効果**: Pages 配信量の大幅削減(1デプロイあたり約62MB減)/ 復旧経路の単純化(cache → Release → **v2**)/ 劣化コピー(v1 は job_code 空・rank_fluctuation=0・percent 由来の丸め)の除去。
- **参照**: LULU-006(v1 は廃止方向)/ LULU-015(v1 は復旧入力でもある・v2 とセットで廃止)/ LULU-062(era 対応)/ P3。

## 1. スコープ

**触るもの**
- `.github/workflows/maplen-board-pages.yml` — v1 の生成・取り込み設定の除去
- `exp_ranking/bot/config.py` — v1 関連の設定関数の撤去
- `exp_ranking/bot/main.py` — v1 の書き出し・取り込み・hydrate 経路の撤去(**取得ロジックには触れない**)
- `exp_ranking/bot/sqlite_storage.py` — v1 専用関数の撤去(下記4つ)
- `exp_ranking/bot/mvp_export.py` — v1 エクスポート関数(`export_mvp_json`)の扱い
- 関連テスト・開発補助(`inject_dummy_gains.py` の v1 前提)

**触らないもの**
- **取得ロジック(fetch / リトライ / スキップ判定)= LULU-004**
- **v2 のスキーマ・生成経路**(`build_v2_payloads` / `export_mvp_v2_json`)
- **Release 耐久層・snapshot guard・v2シャード復旧**(P3・B' で確立済み)
- web(**既に v2 のみを参照**。`useRankingBoard.js:315` / `taskManager/integrations/rankingSource.js` とも `data/v2/rankings.json`)
- DB スキーマ

## 2. 事前調査で判明した事実(実測済み)

| 事実 | 根拠 | 意味 |
|---|---|---|
| **web は v1 を一切読まない** | `grep` で v2 のみ | 配信停止で **UI は無影響** |
| **worldId は 100% 充填(7,982/7,982)** | Release DB 実測 | `HYDRATE_META_FROM_PAGES` を切っても **worldId は navigator の `sync_world_ids` で賄えている**見込み(要実測確認) |
| **`read_json_updated_at` は DB 優先のフォールバック** | `main.py:660-665`(`from_db` を先に返す) | v1 が無くなっても **DB 由来の値が使われる** |
| **ローカル bat は v2 経由** | `sync_rankings_from_pages.py` が `data/v2/...` | **P5 相当は充足済み**(P4 で壊れない) |
| navigator は既に v1 を使わない | `SNAPSHOT_IMPORT_FROM_PAGES: "false"` / `HYDRATE_META_FROM_PAGES: "false"` | 変更は **pages 側のみ** |

## 3. 設計

### 3.1 停止する設定(pages.yml)
| 対象 | 現在 | P4 後 |
|---|---|---|
| `MVP_JSON_OUTPUT_PATH: ../web/public/data/rankings.json` | v1 を生成 | **削除**(v1 を生成しない) |
| `SNAPSHOT_IMPORT_FROM_PAGES` | `[web-only]` 以外で `true` | **`false` 固定 → 最終的に設定ごと削除** |
| `HYDRATE_META_FROM_PAGES` | 同上 | **同上** |
| `MVP_PAGES_RANKINGS_URL: .../data/rankings.json` | v1 の取り込み元 | **削除** |

### 3.2 撤去するコード(v1 専用)
- `sqlite_storage.py`: **`import_missing_snapshots_from_url`(764)** / **`import_snapshots_from_mvp_json`(803)** / **`hydrate_character_meta_from_url`(369)** / **`hydrate_character_meta_from_json`(436)**
- `config.py`: `mvp_json_output_path` / `pages_rankings_url` / `snapshot_import_from_pages` / `hydrate_meta_from_pages`
- `main.py`: 上記を呼ぶ経路(`bootstrap_database` の v1 import ブロック・v1 hydrate・v1 への export)
- `mvp_export.py`: `export_mvp_json`(v1 出力)。**v2 側の関数と共有しているヘルパは残す**
- **削除は「参照ゼロ」を確認してから**。1つでも残る参照があれば停止・報告。

### 3.3 配信からの除去(**404 にはせず「廃止案内 JSON」へ置換**)

> ユーザー裁定 2026-07-30: **即 404 にしない**。62MB の実データ生成・配信は止めたうえで、**同じ URL に小さな廃止案内 JSON を配置**する。

- **`/data/rankings.json` は残すが、中身を以下の小ファイルに置換**する(**v1 データの維持ではなく、第三者利用者への廃止案内**):
```json
{
  "deprecated": true,
  "message": "This endpoint has been retired.",
  "replacement": "/data/v2/rankings.json",
  "retiredAt": "2026-07-30"
}
```
- **実装方針**: 動的生成ではなく、**静的ファイルとしてリポジトリに置く**(例 `exp_ranking/web/public/data/rankings.json` を追跡対象にして小ファイルをコミット)。
  - ⚠ 現在このパスは `.gitignore`(13行)で無視されている。**廃止案内ファイルを追跡するために除外設定の調整が必要**。**bot が同じパスへ書き出さなくなること**(§3.1)が前提。
- **案内ファイル自体の削除は P7 で改めて判断**する(本計画では削除しない)。

### 3.4 復旧チェーンの最終形
```
① actions cache → ② Release db-store → ③ v2 シャード → cold start
```
(P3 時点の「v1」段を削除。**v2 は B' で厳密復元・P3 で有効化済み**)

### 3.4.1 【必須・事前検証】worldId の復旧経路(ユーザー指定 2026-07-30)

> 現在 100%(7,982/7,982)埋まっている**事実の確認だけでは不十分**。v1 hydrate を撤去しても**復旧後に worldId が維持・回復されるか**を実証してから v1 を廃止する。

**実証すべき4点**(**v1 撤去のコミット前に実施**):
| # | 検証 | 期待 |
|---|---|---|
| W1 | **Release DB 復元後も worldId が維持される** | 復元した DB の `world_id != ''` が **100% を維持** |
| W2 | **v2シャード復元後の worldId 状態** | v2 経路で復元した DB の worldId 充填率を**実測して記録**(v2 は worldId を含むか含まないかを明確化) |
| W3 | **worldId 欠損時に navigator の `sync_world_ids` で回復する** | 意図的に `character_meta` を空にした DB で navigator 経路を通し、**worldId が再充填される**ことを確認 |
| W4 | **`HYDRATE_META_FROM_PAGES` を削除しても充填率が低下しない** | 反映前後の Release DB で **100% を維持** |

**回復できないケースが1つでもあれば**:
- **v1 廃止を止める**、または
- **v2 または navigator 側に正規の代替を設計**して**報告**する(独断で代替実装を入れない)。

### 3.5 開発補助の扱い
- `inject_dummy_gains.py` は v1(`MVP_JSON_OUTPUT_PATH`)前提。**v2 を対象にするか、ツールごと撤去するかを実装時に判断し報告**する(本番経路ではないので停止条件ではない)。

## 4. 受け入れ基準(数値で)

| # | 基準 | 目標値 | 測定方法 |
|---|------|--------|----------|
| 1 | bot テスト | 全緑 | `cd exp_ranking/bot && python -m pytest` |
| 2 | web ビルド+テスト | 成功・全緑(**web は不触**) | `npm run build && npm run test` |
| 3 | **v1 を生成しない** | ビルド成果物に `data/rankings.json` が**存在しない** | `dist/` 検査 |
| 4 | **v1 が廃止案内へ置換** | 反映後 `https://lulumi-tools.com/data/rankings.json` が **200 で廃止案内 JSON**(`deprecated:true` / `replacement` / `retiredAt`)を返し、**サイズが 1KB 未満**(従来 約62MB) | 実 HTTP + サイズ |
| 4b | **Pages 成果物サイズの削減** | dist が **約62MB 減少** | ビルド前後の `dist/` サイズ実測 |
| 4c | **worldId の復旧実証 W1〜W4** | §3.4.1 の4項目すべて成立(**1つでも不成立なら停止**) | 合成条件+実 DB |
| 5 | **v2 は不変** | 公開 v2 の `snapshotDays`/`snapshotCount`/主要キャラの gain が**反映前後で一致** | 本番 v2 の突合 |
| 6 | **worldId が退行しない** | `character_meta` の `world_id != ''` が **7,982/7,982(100%)を維持** | Release DB 実測(前後比較) |
| 7 | **snapshot_days / rows が退行しない** | 反映前後で連続・欠落0 | Release DB 実測 |
| 8 | **ガードが通る** | snapshot guard が合格し続ける(実基準は公開v2+Release の2本) | run ログ |
| 9 | **取得ロジック不触** | `main.py` の fetch/リトライ/スキップ部の **diff 0** | `git diff -w` |
| 10 | **v1 参照ゼロ** | リポジトリ全体で v1 パス/関数への参照が **0件**(テスト・ドキュメント除く) | `grep` |
| 11 | 復旧チェーン | cache → Release → v2 で成立(v1 段が消えている) | 合成テスト+run ログ |

## 5. 停止条件

- **`read_json_updated_at` / `ensure_ranking_fetched_at_meta` の除去が、スキップ判定(LULU-004)に波及する**と判明した
- **worldId 充填率が下がる**(基準6 未達)= navigator だけでは賄えていない
- **§3.4.1 の W1〜W4 のいずれかが不成立**(復旧後に worldId を維持・回復できない)→ **v1 廃止を止める / 正規の代替を設計して報告**(独断で代替実装を入れない)
- 廃止案内 JSON を配置するために **bot の書き出し先と衝突**して解決できない
- v1 撤去後に **v2 の生成内容が変わる**(基準5 未達)
- 撤去対象の関数に **v2 経路からの参照が残っている**
- 取得ロジックに触れる必要が生じた

## 6. 注意点(公開面)

- **公開中の v1 URL(`/data/rankings.json`)は 404 になる**。第三者が直接利用している可能性は否定できないが、**LULU-006/015 で廃止が既定路線**であり、**当サイトの UI は v2 のみを使用**している。
- v1 は**劣化コピー**(job_code 空・rank_fluctuation=0・percent 由来の丸め)であり、**維持する価値が無い**ことは LULU-015 で確認済み。

## 7. コミット分割(単独 revert 可)

1. **workflow から v1 の生成・取り込み設定を除去**(= v1 の生成停止・配信停止。**挙動変更の本体**)
2. **v1 専用コードの撤去**(`sqlite_storage` 4関数 / `config` / `main.py` の呼び出し経路 / `export_mvp_json`)
3. `inject_dummy_gains.py` の対応(v2 化 or 撤去)+ 関連テストの整理

> 1 だけで**配信は止まる**。2 は参照ゼロを確認してからの掃除。

## 8. 検証コマンド

```
cd exp_ranking/bot && python -m pytest
cd exp_ranking/web && npm run build && npm run test
python -c "import yaml;yaml.safe_load(open('.github/workflows/maplen-board-pages.yml',encoding='utf-8'))"
git diff -w -- exp_ranking/bot/main.py            # 取得ロジック部が0であること
grep -rn 'data/rankings\.json\|MVP_PAGES_RANKINGS_URL\|SNAPSHOT_IMPORT_FROM_PAGES' --include=*.py --include=*.yml . | grep -v docs/
curl -sSI https://lulumi-tools.com/data/rankings.json | head -1   # 反映後 404
```

## 9. ロールバック

- 各コミット単独 revert 可。**revert すれば v1 の生成・配信・取り込みが復活**する。
- **DB・v2 形式・Release/Drive 層は不変**なのでデータ損失リスクなし。
- v1 は生成物(`.gitignore` 済み)なので、**リポジトリの内容は変わらない**。

## 10. 完了報告テンプレ

- 実施コミット(3分割のハッシュ):
- 受け入れ基準の実測値(§4 全11行):
- **worldId 充填率の前後比較**(基準6):
- **公開 v2 の前後突合**(基準5):
- v1 参照ゼロの確認結果(基準10):
- `git diff -w` の要点(**取得ロジック 0 の証明**)・**未push/本番未反映の明示**:
- 残課題・watch-item(P5/P5.5/P6 への申し送り):
