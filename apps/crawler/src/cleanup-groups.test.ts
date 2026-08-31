import { describe, expect, test } from "vitest";
import { buildCleanupGroupIds } from "./cleanup-groups.js";
import type { GroupData } from "./scraper.js";
import { NO_GROUP_ID } from "./scrapers/group.js";

function groupData(id: string): GroupData {
  return { group: { id, name: `Group ${id}` } } as unknown as GroupData;
}

describe("buildCleanupGroupIds", () => {
  // スクレイプが全部失敗すると groupDataList は空になる。ここで {ids:["0"]}
  // 実在するグループが全部消える。null を返してクリーンアップ自体を止める。
  test("スクレイプ結果が空ならクリーンアップを行わせない", () => {
    expect(buildCleanupGroupIds([])).toBeNull();
  });

  test("カスタムグループと擬似グループの両方を残す", () => {
    const result = buildCleanupGroupIds([
      groupData("101"),
      groupData(NO_GROUP_ID),
      groupData("102"),
    ]);

    expect(result).toEqual({ ids: ["101", "102", NO_GROUP_ID] });
  });

  // 擬似グループしか取れなかった場合。カスタムグループが 0 件という結論は
  test("擬似グループだけでも擬似グループ自身は残す", () => {
    expect(buildCleanupGroupIds([groupData(NO_GROUP_ID)])).toEqual({ ids: [NO_GROUP_ID] });
  });

  // 擬似グループを取りこぼすと、それ自体が削除対象になる。
  test("入力に擬似グループが無くても結果には必ず含める", () => {
    const result = buildCleanupGroupIds([groupData("101")]);

    expect(result?.ids).toContain(NO_GROUP_ID);
  });

  test("擬似グループを重複させない", () => {
    const result = buildCleanupGroupIds([groupData(NO_GROUP_ID), groupData(NO_GROUP_ID)]);

    expect(result).toEqual({ ids: [NO_GROUP_ID] });
  });
});
