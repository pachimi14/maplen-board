# IMPL_PLAN — 同一人数の討伐が複数ある場合の取りこぼし修正(4人・6人・6人)

> 状態: 統括承認済み(ユーザー報告 2026-08-21「4人6人6人の場合、4人のラッフルしか読み込まれない」)
> ブランチ: `raffle/multi-clear-same-count`(origin/main 起点・コミットする・push しない)
> **サーバー+Web の両方を変更**(反映時に VPS raffle-api 更新+再起動が必要)

## 0. 統括のコード調査で確定した2つの失敗モード

`_one_hour_party_cluster` は **(レイヤー × partyCount) につき1クラスタしか作れない**構造:

```python
matching = [v for v in values if v[2] == expected_party_count]
if len(matching) > 1:
    ambiguous = True
    continue          # ← 失敗モードA: 同じ人数で2回討伐したメンバーを丸ごと除外
...
if best_count < minimum_members or len(best_clusters) != 1:
    return {}, ...    # ← 失敗モードB: 同人数の別グループが2つあると partyCount ごと破棄
```

- **A**: あるメンバーが同じ partyCount の討伐に2回参加していると、そのメンバーが候補から完全に消える
- **B**: 同じ人数の異なるグループが2つ成立すると、その partyCount の候補が**丸ごと消える**

→ 「4人・6人・6人」では 6人側が A/B の両方に該当して消え、**4人だけが残る**(報告と一致)。

**Web側にも同じ制約**: `contract.js` の `clearIdentity = boss:bossDifficulty:partyCount` による重複拒否があり、サーバーが同人数の2件目を返しても **`invalidClear` で payload ごと拒否**される。**両側を直さないと表に出ない**。

**構造原因**: LULU-077 の「各ボスは開催回ごとに1回しか討伐できない」という前提が実態と合っていない(同一ボス・同一人数で週内に複数回討伐しうる)。LULU-096 で「partyCount 別に複数候補」までは一般化したが、**同一 partyCount 内の複数討伐**は未対応のまま残っていた。

## 1. 修正内容

### S1. サーバー: 同一 partyCount 内の複数クラスタに対応(`normalizer.py`)

`_one_hour_party_cluster`(単数)を **`_one_hour_party_clusters`(複数返し)** へ一般化する:

1. 対象 partyCount に一致する履歴を **メンバーごとに複数保持したまま** `(clearedAt, memberId, history)` に平坦化(**モードAの `continue` を廃止**)
2. `clearedAt` 昇順にソート
3. 貪欲クラスタリング: 未割当の最も古いレコードを種とし、**種から `CLEAR_CLUSTER_WINDOW`(1時間)以内**かつ**そのクラスタに未登場のメンバー**のレコードを順に取り込む。取り込んだレコードは割当済みにする
4. 全レコードが割り当てられるまで繰り返す
5. `len(cluster) > partyCount` のクラスタは不成立として破棄(公式人数を超えられない)
6. 各クラスタを**独立した clear 候補**として emit。`clearId` は **`clear-{boss}-{difficulty}-p{partyCount}-{index}`**(index はクラスタの最古 `clearedAt` 昇順で 1 から採番)で一意化
7. **`clearedAt`(クラスタ内の最古、ISO 8601 UTC)を clear payload に追加**(下記 S3 の識別表示に使う)

**曖昧性の警告は残す**: あるメンバーの複数履歴が**同一クラスタ内で競合**する(同じクラスタに同じメンバーの2件目が入る余地がある)場合のみ `ambiguous_party_cluster` を出す。単に「同人数の討伐が複数ある」だけでは警告しない(それは正常な状況)。

### S2. Web: 同一 (boss, difficulty, partyCount) の複数 clear を受け入れる(`contract.js`)

- `clearIdentity`(`boss:bossDifficulty:partyCount`)による重複拒否を**廃止**し、**`clearId` の一意性のみ**で判定する
- `clearedAt` を受け入れる(形式検証: ISO 8601・不正なら空文字として扱い拒否はしない)
- `clears` 配列の上限は現行の 36 を維持(2ボス×3難易度×6人数×複数討伐でも実用上十分。超過時は既存どおり拒否)

### S3. Web: 候補を見分けられるようにする(`RaffleCalculatorRoot.jsx`)

同一ボス・同一難易度・同一人数の候補が並ぶため、現在のラベル(`Hard Will + Eternal Ascendant · 討伐N人・履歴H人・分配M人`)では**区別できない**。

- 各候補のチェックボックス行に **討伐時刻(`clearedAt` のローカル表記)** を併記する(既存の `formatRaffleRoundLocal` 系ヘルパーを再利用)
- `clearedAt` が空の場合は時刻を出さない(従来表示に劣化)
- 複数選択時の合算(LULU-096)の挙動は不変

## 2. 受け入れ基準

1. 合成データ「partyCount 4 が1件・partyCount 6 が2件(別グループ)」で、**候補が3件**返り、Web の契約検証を**すべて通過**する
2. 同一メンバーが 6人討伐に2回参加しているケースで、そのメンバーが**両方のクラスタに現れる**(モードA解消)。従来は候補から消えていた
3. 候補それぞれの `clearId` が一意で、`clearedAt` が UI に表示され**時刻で区別できる**
4. 単一クラスタの従来ケースは**出力内容が不変**(clearId 形式の変更を除く)= 回帰なし
5. `ambiguous_party_cluster` は「同一クラスタ内でメンバー履歴が競合する」場合のみ発火し、正常な複数討伐では発火しない
6. raffle-api pytest 全緑 / web テスト全緑 / build 成功 / 6ロケールパリティ

## 3. 変わってはいけない

- 分配計算・5%手数料・PC除算・送金アルゴリズム・メンバー順正規化
- Ascendant 照合(LULU-130)、分類規則(LULU-119)
- wallet のログ・キャッシュ非保存方針 / 新規npm依存 0

## 4. 検証コマンド

```
cd server/raffle-api && python -m pytest -q
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
```

## 5. ロールバック

S1/S2/S3 を分離コミット。サーバーは旧ファイルを退避してから差し替える。
