# SH-28 — 装備候補からアイテムIDの表示を外す

実施: 2026-08-06 / 実装担当

**ユーザー指示**: アイテムIDは表示しないでください。

## 1. 変更

`EquipmentSelector.jsx` の候補行が `AbsoLab Ancient Bow #1592019 · ☆22まで` のように
`#<itemId>` を表示していたのを、`AbsoLab Ancient Bow ☆22まで` のように **ID部分だけ**外した。

```diff
                     <span className="font-semibold">{candidate.itemName}</span>
                     <span className="text-slate-500 ml-2">
-                      #{candidate.itemId} · {t("sfhistory.equipment.maxStarBadge", { maxStar: candidate.maxStar })}
+                      {t("sfhistory.equipment.maxStarBadge", { maxStar: candidate.maxStar })}
                     </span>
```

`equipmentSearch.js`(検索マッチ条件)は**一切変更していない**。`matchesEquipmentQuery` は
もともと `candidate.itemName` と `candidate.itemId` を別々に見ており、表示用文字列
(`#{candidate.itemId} · ...`)には依存していなかった — 表示を消してもマッチ条件は無傷。
閉じた入力欄(`value={... selectedItemName ?? ""}`)ももとから itemName のみで、ID表示は無かった。

## 2. 停止条件の確認

計画 §4-1 の「表示を消すと ID 検索も消える構造」には該当しなかった。表示行 (JSX) と
マッチ条件 (`equipmentSearch.js`) は最初から別コードパスで、同じ文字列を共有していない。
よって停止せず実装を完了した。

## 3. 受け入れ基準

- **(a)** 候補・選択後の表示に `#<数字>` が出ない — 上記 diff で確認。閉じた入力欄はもとから
  ID非表示だったので変更不要
- **(b) ★ID検索は動く** — `equipmentSearch.js` は無変更なので既存の ID 検索テストは
  そのまま全緑。加えて計画の実例(`1382265` → `Arcane Umbra Staff`。SH-26 で実データ確認済みの
  組)をそのまま使う専用テストを `equipmentSearch.test.js` に追加し固定:
  `SH28: ID search survives removing the id from the display`
- **(c)** alias 検索 → 代表 itemId で叩く性質は無変更(`flattenCandidates`/`onSelect` 呼び出し側とも触っていない)
- **(d)** `☆22まで` バッジ(`maxStarBadge`)は残っている — diff の通り、削除したのは
  `#{candidate.itemId} · ` の部分のみ
- **(e)** 並び順(`equipmentSearch.js` の `localeCompare` 昇順)は無変更(このファイル自体を
  今回一切編集していない)
- **(f)** `npm run test`: 43 files / **452 tests 全緑**(今回追加した1件を含む)。
  `npm run build`: 成功(7.06s、既存の chunk サイズ警告のみ、エラーなし)。`server/` 差分ゼロ
  (`git diff --stat server/` 出力なし)
- **(g)** 6ロケール(ja/en/vi/zh-TW/th/es)は今回変更していない(`maxStarBadge` の文言自体に
  ID は含まれていなかったため、文言変更不要)
- **(h)** SH-7〜SH-27 のテストは今回のスイート実行にすべて含まれ全緑(個別に削除・改変していない)
