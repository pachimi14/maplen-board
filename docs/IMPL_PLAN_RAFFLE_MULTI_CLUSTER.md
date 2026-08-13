# IMPL_PLAN — 同一ボス・同一難易度の複数クリア候補(別partyCountクラスタ)の合算対応

> 状態: 統括承認済み(ユーザー実利用ケース起点・挙動確定はユーザー指示)
> ブランチ: `codex/raffle-calculator`(コミットは行う。push はしない)

## 0. 問題(ユーザー報告・統括がコードで根因特定)

実ケース: 保存PT6人(A〜F)。A〜Eは partyCount=5 の Hard Will、Fは別PTの partyCount=6 の Hard Will をクリア。**Fの当選分を混ぜて6人で分配したい**が、現在は「1PT分(A〜E)しか読み込まれない」。

根因: `server/raffle-api/normalizer.py` の候補選定が、ボス×難易度ごとに**履歴人数最大の1クラスタのみ採用**(`largest_clusters[0]`)し、他の成立クラスタ(F の partyCount=6・履歴1人)を黙って破棄している。LULU-079 の「同人数の最大グループが複数なら除外」の仕様を「最大以外は返さない」まで広げた実装になっている。

## 1. 確定仕様(LULU-096 として記録済み)

- ボス×難易度ごとに、**成立する全クラスタ(observed partyCount ごとの1時間窓一意最大グループ)を独立した候補 clear として返す**
- 同一 partyCount 内で最大グループが複数(判定不能)の場合は、**その partyCount のクラスタだけ**を `ambiguous_party_cluster` 警告付きで除外(他の partyCount 候補は返す)
- Web 側は既存の複数選択→合算(`combineSelectedPartyClears`)で、同一難易度の複数候補も合算可能にする(現在は複数難易度のみを想定した表示)。人数不一致の明示確認(`requiresDistributionConfirmation`)は**選択した各 source clear ごと**に既存どおり要求する
- LucidとWillの分離、対象ボス限定、その他の判定条件(同一開催回・layerId・1時間窓)は不変

## 2. 変更対象

### サーバー `server/raffle-api/normalizer.py`

- `largest_clusters` の単一選択を廃止し、`viable_clusters` の**各要素を clear として emit**
- `clearId` の一意化: 現在 `clear-{boss}-{difficulty}` → **`clear-{boss}-{difficulty}-p{partyCount}`**(同一難易度複数候補で重複するため必須)
- ambiguous 判定を partyCount 単位に変更(`_one_hour_party_cluster` の ambiguous はそのクラスタのみ skip+警告)
- 出力順: difficulty 順 → partyCount 昇順で安定化

### Web `exp_ranking/web/src/raffle/`

- `RaffleCalculatorRoot.jsx`: 候補が複数のとき表示される選択 fieldset は既存のまま流用可(`group.clears.length > 1`)。**初期自動選択**(1件のときのみ自動選択)も既存のまま
- 候補ラベルの区別: 同一難易度で複数候補が並ぶため、`formatPartyClearTitle` は変えず、**チェックボックスの副文(既存の 討伐N人・履歴参加H人・分配M人)で区別**する。選択済み候補のタブボタンラベルには件数表示(既存 `selectedCandidateCount`)が出るため変更不要
- `domain/partyClears.js`: `combineSelectedPartyClears` は同一 boss の複数 clear を既に合算できる(メンバー毎の加算+drops連結)。**変更不要の見込み**だが、同一難易度2候補の合算テストを追加して固定する
- `domain/contract.js`: clearId 形式のバリデーションがあれば新形式に追随(なければ変更不要)
  - **実装時判明(実装担当の停止報告→統括承認)**: `normalizeJobPayload` の重複判定キーが `boss:bossDifficulty` のみで、同一難易度の2候補目を `invalidClear` として拒否していた=本件の必須修正。キーを `boss:bossDifficulty:partyCount` へ変更し、clears 上限を 6→36 に拡張

### テスト

- サーバー: 「同一難易度で partyCount=5(履歴5人)と partyCount=6(履歴1人)の2クラスタ→**両方**返る」「片方の partyCount 内で同数最大グループ複数→そのクラスタのみ警告・除外、他方は返る」「clearId が p{partyCount} 付きで一意」
- Web: 「同一難易度2候補を複数選択→合算結果のメンバー別金額が両クリアの和」「各 source clear の人数不一致確認が独立に要求される」

## 3. 変わってはいけない

- 取得API呼び出し回数・上流リクエスト形状
- 既存の単一クラスタケースの出力内容(clearId の形式変更を除き、金額・メンバー・警告は同一)
- 精算計算(`settlement.js`)・保存形式・schemaVersion(=3 のまま。追加ではなく既存フィールド内の変化のため)

## 4. 受け入れ基準

1. ユーザー実ケース(6人PT・5人討伐A〜E+6人討伐F)で、Hard Will 候補が**2件**表示され、両方選択→確認チェック→**6人分配**の精算が出る(fixtureまたは合成テストで再現)
2. 既存テスト全緑+新規テスト(サーバー・Web)緑、build 成功
3. clearId 重複 0(同一レスポンス内)
4. 単一クラスタの従来ケースは金額・警告とも出力不変(clearId 形式のみ変化)

## 5. 検証コマンド

```
cd server/raffle-api && python -m pytest -q
cd exp_ranking/web && npm run test
cd exp_ranking/web && npm run build
```

## 6. ロールバック

コミット単位 revert(サーバー1・Web1〜2コミットに分ける)。

## 7. 配備(統括が実施)

ローカル8782再起動 → チェックサイト再ビルド・再配置 → VPS raffle-api 差し替え(サービス再起動のみユーザー1コマンド)。
