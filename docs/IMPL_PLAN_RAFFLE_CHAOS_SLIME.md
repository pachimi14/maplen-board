# IMPL_PLAN — 分配対象に Chaos Guardian Angel Slime を追加

> 状態: 統括承認済み(ユーザー指示 2026-09-03 = LULU-141)
> ブランチ: `feat/raffle-chaos-slime`(main から切る・push はユーザー専権)

## 0. 背景と実測事実(推測ではなく公式APIの実データ)

VPS から公式APIを直接叩いて確認した(2026-09-03 実施、2026-08-27 回)。

| 項目 | 実測値 | 取得元 |
|---|---|---|
| bossName | `Guardian Angel Slime` | `POST /v1rc1/msn/layers/static` layerId **205045** |
| 難易度 | `DIFFICULTY_CHAOS`(minLevel 245) | 同上 |
| 抽選周期 | `RAFFLE_PERIOD_TYPE_WEEKLY`(Lucid/Will と同じ木曜回) | 同上 |
| Ascendant 層 | `Eternal Ascendant Chaos Guardian`(contents layerId **308072**) | ボス討伐 `2026-08-22T14:30:13.660Z` ↔ Ascendant `…13.673Z` の対応で確定 |
| Ascendant 報酬枠 | `itemId 1`(NESO)/ `itemId 2358012`(Rank 1 Special Skill Ring Box) | 同回の `prizes` |
| 実際の当選例 | Ascendant NESO **325,000,000** | 同上 |
| ボス本体の当選例 | `prizes: []`(`state=RAFFLE_STATE_PARTICIPATE_FAIL`)・`partyCount: 6` | 同上 |

**ユーザー裁定(2026-09-03)**: Chaos のみ対象。**Slime にコイン・固有アイテム・装備・パワークリスタルは無い。Ring Box と NESO の分配だけでよい。** Normal Guardian Angel Slime(205038 / `Dawning Ascendant 1`)は今回対象外。`Sealed Nodestone` の分類は今回触らない。

## 1. スコープ

`Chaos Guardian Angel Slime` を Lucid / Will と同格の分配対象ボスとして追加する。分配される報酬は **ボスNESO / Ascendant NESO / Ring Box(EQUIPMENT 扱い・売却額入力)** のみ。

## 2. 変わってよい

- server: `normalizer.py` のボス語彙テーブルと対象ボスのループ、`CLASSIFICATION_VERSION`
- web: `contract.js` / `partyClears.js` / `settlement.js` / `RaffleCalculatorRoot.jsx` のボス集合
- 6ロケールの「Lucid と Will」という文言
- パワークリスタルのレート入力の表示条件(下記 S6)

## 3. 変わってはいけない

- **取得ロジック(`msu_client.py`)は変更禁止**。新しいエンドポイントを増やさない(既存の history + layers/static + item metadata だけで足りる)
- Lucid / Will の分配金額(既存テストの期待値は 1 円も動かない)
- 5% 手数料・PC 除算(四捨五入)・送金アルゴリズム・繰越の ±0 チェック
- `Sealed Nodestone` / Florin の分類(今回は据え置き。引き続き `excludedRewards` に出る)
- Will 専用の FT Item(`Sealed Mirror World Nodestone`)の出し分け条件
- localStorage の保存形式・キー
- 新規 npm / pip 依存 **0**

## 4. 実装(S1〜S7)

### S1. server: ボス語彙の追加(`server/raffle-api/normalizer.py`)

- `TARGET_BOSSES` に `"Guardian Angel Slime": "SLIME"` を追加
- `ASCENDANT_TIER_BY_BOSS` に `("SLIME", "DIFFICULTY_CHAOS"): "Eternal Ascendant Chaos Guardian"` を追加(**NORMAL は追加しない**。テーブルに無い難易度は `_boss_distribution_context` が `None` を返して分配候補にならない = 今回のスコープどおり)
- `BOSS_DIFFICULTIES` に `"DIFFICULTY_CHAOS": "CHAOS"` を追加
- `normalize_live_history` の `difficulty_order` を `{"CHAOS": 0, "HARD": 1, "NORMAL": 2, "EASY": 3}` に変更(CHAOS が最上位)
- `normalize_live_history` の `for boss_code in ("LUCID", "WILL")` に `"SLIME"` を追加

### S2. server: コインを持たないボスの安全化(`_member_settlement`)

現状 `coin_name = TARGET_COINS[boss_code]` は SLIME で **KeyError** になる。さらに現在の分岐は「COIN と分類されたが期待コイン名と違う」報酬が **どの枝にも入らず黙って消える**(LULU-119 と同じ失敗クラス)。

- `coin_name = TARGET_COINS.get(boss_code, "")` にする
- `classification == "COIN"` かつ `name != coin_name`(コイン未設定ボスを含む)の報酬は **`excludedRewards` に積む**。黙って捨てない
- SLIME はコイン設定なし = COIN 分類の当選が来たら必ず画面の「分配対象外の報酬」に出る

### S3. server: fixture モードの追随

`fixture_result` に SLIME の clear を1件追加する。**コイン・パワークリスタルは 0 / drops は Ring Box 相当1件のみ**にして、「Slime はコインもPCも無い」という実データの形を fixture でも保つ。`ascendantTier` は `"Eternal Ascendant Chaos Guardian"`。

### S4. server: `CLASSIFICATION_VERSION` を 3 → 4

新しい `boss` コード `SLIME` を含む payload を旧 web バンドルが受けると `RAFFLE_BOSSES.includes()` で payload 全体が弾かれる。バージョンを上げて **明示的な不整合表示**に倒す。デプロイ順は §8。

### S5. web: ボス集合の追加

- `domain/contract.js`
  - `RAFFLE_BOSSES` に `"SLIME"`
  - `ASCENDANT_TIER_BY_CLEAR` に `"SLIME:CHAOS": "Eternal Ascendant Chaos Guardian"`
  - `RAFFLE_CLASSIFICATION_VERSION` を **4**(server と厳密一致)
- `domain/partyClears.js`
  - `DISTRIBUTABLE_BOSSES` に `"SLIME"`
  - `formatPartyBossName`: `SLIME` → `"Guardian Angel Slime"`
  - `groupPartyClearCandidates` のボス順配列に `"SLIME"` を追加(表示順は `LUCID, WILL, SLIME`)
- `domain/settlement.js`: `BOSSES` に `"SLIME"`
- `RaffleCalculatorRoot.jsx`: `{ LUCID, WILL }` を列挙している **全箇所**に `SLIME` を追加する。**grep で全数確認すること**(`initialDistributionSettings` / `selectedClearIdsByBoss` の初期値とリセット2箇所 / `calculated: null` リセット2箇所 / `initialSelections`)。取りこぼすと「Slime を選ぶと落ちる/リセットされない」になる

### S6. web: パワークリスタル入力の表示条件

現在 `include.powerCrystal` が真なら常にレート入力が出る。Slime は PC が無いため無意味な入力欄になる。

- **その clear の `powerCrystalAmount` の合計が 0 のときは、PC のトグルとレート入力を出さない**(ボス名で分岐しない)
- 合計が 0 でなければ従来どおり表示 = Lucid / Will の既存挙動は PC がある限り不変
- ボス名でなく実測値で分岐する理由: 将来 Chaos Guardian の Ascendant が PC を出し始めたら**自動的に表示に戻る**(黙って落とさない)

### S7. i18n(6ロケール同時)

`raffle.subtitle` / `raffle.distributionScope` / `raffle.noPartyClears` の「Lucid と Will」相当の文言を、Chaos Guardian Angel Slime を含む表現に更新する。**キーの追加ではなく既存キーの文言修正**。6ファイル(`ja/en/es/th/vi/zh-TW`)すべてに反映し、パリティテストを緑に保つ。

## 5. テスト(既存の機械チェックに乗せる)

- `tests/test_ascendant_layer_vocabulary.py` は `ASCENDANT_TIER_BY_BOSS` を **自動パラメータ化**している。S1 の追加により `SLIME/DIFFICULTY_CHAOS` が実語彙 `testdata/raffle/v1/ascendant-layers.json` に対して**一意解決すること**が自動で検証される。`Eternal Ascendant Chaos Guardian` は既に fixture に存在するため fixture 追加は不要
- `testdata/raffle/v1/item-metadata-vocabulary.json` に `{"itemId": 2358012, "itemName": "Rank 1 Special Skill Ring Box", "tier0": "Consumable", "tier1": "Voucher"}` を追加(実測済み・242 → 243 件)。件数を固定しているテストがあれば期待値を追随させる
- 新規テスト(synthetic のみ。実 assetKey / wallet / 生レスポンスは置かない):
  1. Chaos Slime の history(layer 205045 相当・`partyCount 6`・`prizes: []`)+ Ascendant history(`Eternal Ascendant Chaos Guardian` 相当・NESO 325,000,000)から、`boss="SLIME"` / `bossDifficulty="CHAOS"` / `ascendantTier="Eternal Ascendant Chaos Guardian"` の clear が **1件**生成される
  2. その clear の対象メンバーが `bossNeso="0"` / `ascendantNeso="325000000"` / `powerCrystalAmount="0"` / `drops=[]`
  3. Chaos Slime で Ring Box(`itemId 2358012`)を当選した history から、`category="EQUIPMENT"` の drop が 1件出る(売却額入力の対象になる)
  4. **S2 回帰**: コイン未設定ボス(SLIME)で COIN 分類の報酬が来たら `excludedRewards` に出る(黙って消えない)
  5. Normal Guardian Angel Slime(`DIFFICULTY_NORMAL`)の history は **clear 候補にならない**(今回スコープ外であることを固定)
  6. web: `SLIME:CHAOS` の clear を含む job payload が `contract.js` を通り、settlement が `invalid_boss` を出さない
  7. web: Lucid / Will の既存 settlement テストの期待値が **1つも変わらない**

## 6. 受け入れ基準(数値)

1. Chaos Slime の clear が 1件生成され、Ascendant NESO **325,000,000** が分配総額に入る(上記テスト2)
2. 同 clear の PC = **0**、コイン drop = **0件**、FT Item = **0件**
3. Ring Box は `EQUIPMENT` として売却額入力欄が出る
4. Normal Slime は分配候補 **0件**
5. Lucid / Will の既存テスト期待値の変更 **0件**(`git diff` で数値の変更が無いこと)
6. `CLASSIFICATION_VERSION` = 4 が server / web で**一致**
7. `python -m pytest` 全緑 / `npm run test` 全緑 / `npm run build` 成功 / 6ロケールパリティ緑
8. UI で SLIME を選んだとき、パワークリスタルのレート入力が**出ない**(S6)

## 7. 停止条件(該当したら実装を止めて選択肢付きで報告)

- `TARGET_COINS` を SLIME 用に埋める必要が出た(= コインがあることになる)
- `_ascendant_for_boss` の解決ロジックを変えないと `Eternal Ascendant Chaos Guardian` が一意解決しない
- Lucid / Will の既存テストの期待金額を変えないと緑にできない
- `msu_client.py` に手を入れないと実装できない
- `RAFFLE_CLASSIFICATION_VERSION` 以外に web / server の契約差分が必要になった

## 8. デプロイ順(LULU-122 の手順を踏襲。実行はユーザー専権)

`CLASSIFICATION_VERSION` を上げるため、web と server の切り替え窓を最小化する。

1. VPS に新しい server ファイルを配置する(**まだ再起動しない**)
2. PR をマージし、GitHub Pages のデプロイ完了を待つ
3. **完了直後に** `raffle-api.service` を再起動する

## 9. 検証コマンド

```
cd server/raffle-api && python -m pytest -q
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
git diff -w -- <触ったファイル>
```

## 10. ロールバック

コミット単位 revert。`CLASSIFICATION_VERSION` を 3 に戻し、server を再起動すれば旧 web と整合する。

## 11. 完了報告テンプレ

- 触ったファイル一覧(`git diff -w --stat`)
- 受け入れ基準 1〜8 それぞれの実測結果(数値をそのまま貼る)
- `pytest` / `npm run test` / `npm run build` の出力末尾
- 停止条件に触れた項目の有無
