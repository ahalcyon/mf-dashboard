import type { DbExecutor } from "../index";
import { schema } from "../index";
import type { RefreshResult } from "../types";
import { now } from "../utils";

export async function createSnapshot(
  db: DbExecutor,
  groupId: string,
  date: string,
  refreshResult?: RefreshResult | null,
): Promise<number> {
  const result = await db
    .insert(schema.dailySnapshots)
    .values({
      groupId,
      date,
      refreshCompleted: refreshResult?.completed ?? true,
      createdAt: now(),
      updatedAt: now(),
    })
    .returning({ id: schema.dailySnapshots.id })
    .get();

  const snapshotId = result.id;

  return snapshotId;
}
