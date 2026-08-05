# SH-20 完了報告 -- サーバー応答とフロント正規化の契約テスト

計画: `docs/IMPL_PLAN_SH20.md`。前提: SH-19 完了・統括検収済(`dc0bfed`)。
ユーザー指示 2026-08-05「修正して」を受け、`normalizePricesPayload` のホワイトリスト方式が
3回(SH-9: `provisional`/`provisionalDate`、SH-16: `asOf`、SH-19: `closed`)同じ種類のフィールド
サイレントドロップを起こしたことへの恒久対処。実施日: 2026-08-05。
ブランチ: `feat/sf-cost-history`(worktree `msu-ranking-sfhist`)。

## コミット

0. `41fbbd8` -- `docs(sf-history): add IMPL_PLAN_SH20.md`
1. `9370996` -- `test(sh20): add a shared response/normalization field contract read by both Python and JS`
   (`server/sf-history/contract/response_fields.json` 新規 / `server/sf-history/tests/test_response_contract.py` 新規 /
   `exp_ranking/web/src/sfhistory/integrations/contract.test.js` 新規 / `server/sf-history/README.md`)
2. 本コミット -- `docs(sf-history): SH-20 report`(本ファイル)

どちらも単独 revert 可(契約+テストの追加のみ / docs のみ)。§4 の結果、正規化コード
(`sfHistorySource.js`)自体への変更は不要だったため、コード側の第3コミットは作っていない。
`git push` は未実施。

## (a) 契約ファイルの場所と、両側がそれを読んでいることの確認

唯一の正: `server/sf-history/contract/response_fields.json`。

- Python 側: `server/sf-history/tests/test_response_contract.py` が
  `(ROOT / "contract" / "response_fields.json").read_text(...)` で読み込み、`app.py` の実際の
  レスポンスのキー集合と突き合わせる。
- JS 側: `exp_ranking/web/src/sfhistory/integrations/contract.test.js` が
  `readFileSync(new URL("../../../../../server/sf-history/contract/response_fields.json", import.meta.url))`
  で同じファイルを読み込み、`normalizeEquipmentPayload`/`normalizePricesPayload`/`normalizeLatestPayload`
  の出力がこの契約の項目を保持しているか(または `INTENTIONALLY_DROPPED` で明示的に落としているか)を
  確認する。

項目リストは `response_fields.json` の1箇所のみに存在する((a)/(b) の要件どおり、2箇所書きは無い)。

## (b) ★負のテストの手順と結果

### b-1: 契約に項目を1つ足す -> JS 側が落ちる

`server/sf-history/contract/response_fields.json` の `prices.root` に一時的に
`"TAMPER_TEST_NEW_FIELD"` を追加し、`npx vitest run src/sfhistory/integrations/contract.test.js` を実行:

```
FAIL  src/sfhistory/integrations/contract.test.js > contract: /sf-history/prices > keeps every contract root field, or documents the drop
AssertionError: contract field "TAMPER_TEST_NEW_FIELD" (prices.root) must survive normalization
or be listed in INTENTIONALLY_DROPPED: expected false to be true
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

確認後、`response_fields.json` を元に戻し(`git diff -w` で差分なしを確認)、再実行して5件全緑に
戻ったことを確認した。

### b-2: 応答に項目を1つ足す -> Python 側が落ちる

`server/sf-history/app.py` の `/sf-history/prices` の戻り値に一時的に `"TAMPER_TEST_NEW_FIELD": True`
を追加し、`python -m pytest tests/test_response_contract.py -v` を実行:

```
tests/test_response_contract.py::test_prices_root_keys_match_contract FAILED
AssertionError: assert {'TAMPER_TEST_NEW_FIELD', ... 'points', ...} == {'endDate', ... 'priceVersion', ...}
Extra items in the left set:
'TAMPER_TEST_NEW_FIELD'
1 failed, 3 passed in 0.85s
```

確認後、`app.py` を元に戻し(`git diff -w -- server/sf-history/app.py` で差分なしを確認)、
`python -m pytest tests/` を再実行して97件全緑に戻ったことを確認した。

**両方向とも、落ちることを実際に確認した上でのテスト。**

## (c) 現時点で正規化が落としているフィールドの全一覧

`response_fields.json` を書いた時点で、実際のサーバー応答と `sfHistorySource.js` の現状の
ホワイトリストを突き合わせ、以下が現時点で正規化に**落とされている**(素通ししていない)ことを
確認した。いずれも `exp_ranking/web/src/sfhistory` 配下のどこからも参照されていないことを
`grep -rn "\.interval\b|\.labelIs\b|\.upgradeCount\b|\.generatedAt\b|\.excluded\b"` で確認済み
(0件)。フロントの挙動は変えていない -- `contract.test.js` の `INTENTIONALLY_DROPPED` に列挙して
「意図的に落とす」ことをテストで明示した。

- `prices` root: `itemId`(呼び出し側が既に持っている値との一致検証にのみ使用、下流には不要)、
  `interval`、`labelIs`、`upgradeCount`
- `prices` point: なし(`date`/`prices`/`provisional`/`closed`/`asOf` は全て素通し済み)
- `latest` root: `itemId`(同上、検証専用)
- `equipment` root: `generatedAt`、`excluded`
- `equipment` item: なし(`itemId`/`itemName`/`aliasItemIds`/`maxStar`/`aliases` は全て素通し済み)

計画書 §4 が例示していた `current` は、SH-17(`test_app.py` の
`test_prices_provisional_point_carries_asOf_from_latestUpdatedAt` docstring 参照)で
サーバー応答から既に廃止済みであり、現在の契約には存在しない(調査済み・ドリフトの指摘のみ、
対応不要)。

**フロントが実際に使う値は無かったため、`sfHistorySource.js` への素通し追加は行っていない
(§4 の「見つかったら列挙して報告」を満たし、「勝手にフロントの挙動を変えない」を守った)。**

## (d) オフラインであることの確認

- Python: `test_response_contract.py` は `app_module.prices`/`equipment`/`latest` を直接呼ぶだけ
  (img-proxy/既存 `test_app.py` と同じ手作り `Request` パターン)。`/sf-history/latest` の上流呼び出し
  は既存の `FakeCache`(`app_module.app.state.latest_cache` を差し替え)でスタブし、実 API は一切叩か
  ない。新規依存の追加も無し(`httpx`/`TestClient` 等は使っていない)。
- JS: `contract.test.js` はリテラルなペイロードオブジェクトを直接 `normalize*Payload` に渡すのみで、
  `fetch`/`createSfHistorySource` は未使用。ネットワークI/Oなし。

## (e) pytest / npm test / build

```
python -m pytest tests/         97 passed (既存93 + 新規4)
npm run test -- --run           442 passed, 42 files (既存437/41ファイル + 新規5/1ファイル)
npm run build                   成功(vite build, dist/ 生成、既存の chunk サイズ警告のみ・エラー無し)
```

## (f) 挙動不変

画面の見え方は変わっていない。`sfHistorySource.js` は本スライスで**1行も変更していない**
(`git diff -w -- exp_ranking/web/src/sfhistory/integrations/sfHistorySource.js` で確認、差分0)。
§4 で列挙した各フィールドはいずれも既存の未使用フィールドであり、素通しを足していないため、
出力の形は変わらない。

## (g) 4h テーブル / SH-7〜SH-19

`server/sf-history/aggregate.py` / `schema.sql` / `scripts/*` / `db.py` / `fetch_latest.py` /
`src/sfhistory/starforce.js` / `domain/*` は一切触っていない(`git status` で確認)。
`app.py` は負のテスト(b-2)のために一時変更したが、検証後に元へ戻し `git diff -w` で差分無しを
確認済み(コミットには含まれていない)。SH-7〜SH-19 が確立した破線1点・ラベル終了時刻・UTC・
意味色・2桁表記などの性質は無改訂。

## ★起動手順(参考・本スライスでは未使用)

```bash
cd server/sf-history
SF_HISTORY_ALLOWED_ORIGINS="http://localhost:5183" python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```

本スライスのテストはすべてオフラインのため、上記サーバー起動は検証に使っていない
(統括の実機検収で使う場合の参考として記載)。
