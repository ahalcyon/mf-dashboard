import { describe, expect, test } from "vitest";
import { collectBatchItemFailures } from "./batch";

describe("collectBatchItemFailures", () => {
  const ids = ["a", "b", "c", "d"];

  test("失敗が無ければ空を返す", () => {
    expect(collectBatchItemFailures(ids, -1)).toEqual([]);
  });

  test("失敗した位置以降をすべて報告する", () => {
    expect(collectBatchItemFailures(ids, 1)).toEqual([
      { itemIdentifier: "b" },
      { itemIdentifier: "c" },
      { itemIdentifier: "d" },
    ]);
  });

  test("先頭で失敗したら全件を報告する", () => {
    expect(collectBatchItemFailures(ids, 0)).toHaveLength(4);
  });

  test("末尾で失敗したらその1件だけを報告する", () => {
    expect(collectBatchItemFailures(ids, 3)).toEqual([{ itemIdentifier: "d" }]);
  });

  test("空のバッチを扱える", () => {
    expect(collectBatchItemFailures([], -1)).toEqual([]);
  });
});
