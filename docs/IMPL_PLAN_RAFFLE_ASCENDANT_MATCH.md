# IMPL_PLAN — Ascendant レイヤー照合の堅牢化(公式改名によるリグレッション修正)

> 状態: 統括承認済み(ユーザー報告 2026-08-21「パワクリとアセンダントNESOが取得できてない」)
> ブランチ: `raffle/ascendant-layer-match`(origin/main 起点・コミットする・push しない)
> **サーバー変更を含む**(反映時に VPS raffle-api 更新+再起動が必要)

## 0. 調査結果(統括が公式APIの実データで確定 — debug-strategy 準拠)

**症状**: Hard Will の精算で **Power Crystal と Ascendant NESO が全員0**。同じ回の Hard Lucid は正常(PC 3,000,000 / Ascendant NESO 3,000,000)。**2026-08-13 週は正常に取得できていた**ため、**外部起因のリグレッション**。

**直接原因**: `_ascendant_for_boss` は Ascendant レイヤーを **`contents.layerName` の完全一致**で探す:
```python
if _text(contents.get("layerName")).casefold() == target_tier.casefold():
```
公式のレイヤー一覧(197件)を実取得したところ、Eternal Tier が**ボス別に分割**されていた:

| 公式 `contents.layerName` | 対応表(LULU-075)の期待値 | 一致 |
|---|---|---|
| `Dawning Ascendant 1` / `2`、`Blessed Ascendant 1` / `2`、`Mystic Ascendant`、`Luminous Ascendant`、`Glorious Ascendant`、`Divine Ascendant` | 同左 | ✓ |
| **`Eternal Ascendant Hard Will`** | `Eternal Ascendant` | **✗** |
| **`Eternal Ascendant Chaos Guardian`**(新設) | — | — |

→ Hard Will では候補0件 → `matches[0] if len(matches) == 1 else None` が **None** を返し、PC と Ascendant NESO が**サイレントに0**になっていた。

**追加検証(ユーザー指摘「名称変更は来週から/さっきまで動いていた」を受けて実施)**:

- **本件は 2026-08-21 の分類修正デプロイ(LULU-119/123)とは無関係**。同一の 08-20 回を **デプロイ前(classificationVersion 1)** に取得した保存レスポンスでも既に `pc=0 / ascNeso=0` であり、デプロイ後と完全に同値
- **公式はレイヤーを同じ layerId のまま改名した**(retroactive)。正常に動いていた **08-13 回を「今」再取得すると Will は `pc=0 / ascNeso=0`** になり、当該回の Ascendant 当選表示も `Eternal Ascendant Hard Will` に変わっている。履歴は毎回**現在のレイヤー表**と突き合わせるため、改名は**過去の回にも遡って影響**する
- したがって「ゲーム内の変更は来週から」でも、**APIメタデータ側は既に改名済み**であり、現時点で全ての過去回の Hard Will が0になる

**構造原因**: Tier 対応表がリテラル文字列の**完全一致**に依存しており、公式のレイヤー名変更・ボス別分割に追随できない。**LULU-119(装備分類バグ)と同一クラス**=「外部データ語彙とコード側の期待値が機械照合されていない」。

**検出原因**: ①レイヤー名の fixture が合成データで、実語彙と照合していない ②**該当0件が警告なしで0扱い**(サイレント)のため、利用者が数値を見るまで誰も気づけない ③LULU-119 で追加した語彙検査は**アイテムメタデータ(tier0/tier1)のみ**で、**レイヤー名は対象外**だった。

## 1. 修正内容

### S1. 照合ロジックの堅牢化(`server/raffle-api/normalizer.py`)

`_ascendant_for_boss` の照合を次の順で行う(すべて casefold 比較):

1. **完全一致**の候補を集める → 1件なら採用
2. 0件なら **Tier名で始まる(prefix)** 候補を集める
3. prefix 候補が複数のときは、**当該ボスの表示名(`Lucid` / `Will`)を含むもの**に絞る(例: `Eternal Ascendant Hard Will` を選び `Eternal Ascendant Chaos Guardian` を除外)
4. それでも一意に決まらない(0件 or 複数)なら **None を返し、必ず警告を出す**(下記 S2)

**Tier対応表(LULU-075)の6エントリは変更しない**(`Eternal Ascendant` のままで prefix 照合により解決する)。

### S2. サイレントな0を廃止し fail-visible にする(サーバー+Web)

- 対象クリアで Ascendant が解決できなかった場合、レスポンスの `warnings` に
  `{"code": "ascendant_not_found", "boss": <BOSS>, "bossDifficulty": <DIFF>, "expectedTier": <TIER>}` を追加する
- Web(`uiText.js` の `describeRaffleCode`)に対応文言を6ロケール追加。ja例:
  「{boss} の Ascendant Tier({tier})を特定できませんでした。Power Crystal と Ascendant NESO は 0 として扱われています。」
- **0 を黙って計算に混ぜない**(LULU-119 と同じ原則)

### S3. 再発防止 — レイヤー語彙のクラス網羅検査

- 公式レイヤー一覧から**匿名化した Ascendant レイヤー名 fixture** を `testdata/raffle/v1/ascendant-layers.json` に追加(`layerName` のみ。公開ゲームデータ)
- テスト①: **`ASCENDANT_TIER_BY_BOSS` の6エントリすべて**が、fixture のレイヤー名集合に対して S1 のアルゴリズムで**ちょうど1件に解決する**ことを機械検査。将来公式が再び改名したら fixture 更新時に落ちる
- テスト②: `Eternal Ascendant Hard Will` / `Eternal Ascendant Chaos Guardian` が併存する状況で、**Hard Will のクリアが Hard Will 側を選ぶ**ことを固定(ボス名による曖昧性解消の回帰テスト)
- テスト③: 解決できない場合に `ascendant_not_found` 警告が出ることを固定

## 2. 受け入れ基準

1. 実データ相当(`Eternal Ascendant Hard Will` を含む)で、Hard Will のクリアの `powerCrystalAmount` / `ascendantNeso` が **0 でなくなる**
2. Hard Lucid(`Divine Ascendant`・完全一致)の結果が**従来と一致**(回帰なし)
3. 対応表6エントリすべてが実レイヤー名 fixture に対し一意解決(テスト①)
4. 解決不能時に `ascendant_not_found` 警告が出て、Web に人間語で表示される
5. raffle-api pytest 全緑 / web テスト全緑 / build 成功 / 6ロケールパリティ

## 3. 変わってはいけない

- Tier対応表(LULU-075)の6組の意味、5%手数料、PC除算方式、送金アルゴリズム、分類規則(LULU-119)
- wallet のログ・キャッシュ非保存方針
- 新規npm依存 0

## 4. 検証コマンド

```
cd server/raffle-api && python -m pytest -q
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
```

## 5. ロールバック

S1/S2/S3 を分離コミット。サーバーは旧ファイルを退避してから差し替える。
