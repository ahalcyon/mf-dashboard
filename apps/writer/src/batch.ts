/**
 * FIFO キューなので、ある1件が失敗したらそれ以降は適用してはいけない。
 * 先に進めると、失敗した1件を飛ばしたまま後続を書き込むことになり、
 * 再配信されたときに順序が崩れる。
 *
 * 失敗した位置以降のすべてを失敗として報告し、SQS に再配信させる。
 */
export function collectBatchItemFailures(
  messageIds: readonly string[],
  firstFailureIndex: number,
): Array<{ itemIdentifier: string }> {
  if (firstFailureIndex < 0) return [];

  return messageIds.slice(firstFailureIndex).map((itemIdentifier) => ({ itemIdentifier }));
}
