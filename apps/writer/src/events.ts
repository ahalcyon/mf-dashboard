import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

export function createEventsClient(): EventBridgeClient {
  return new EventBridgeClient({});
}

/**
 * 1 回のクロールが送ったものを適用し終えたことを知らせる。
 * 静的サイトの再ビルドはこのイベントが起点になる。
 */
export async function publishCrawlCompleted(
  client: EventBridgeClient,
  options: { busName: string; source: string; detailType: string; runId: string },
): Promise<void> {
  const response = await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: options.busName,
          Source: options.source,
          DetailType: options.detailType,
          Detail: JSON.stringify({ runId: options.runId }),
        },
      ],
    }),
  );

  // PutEvents は個々のエントリが弾かれても HTTP 200 を返す。ここを見ないと
  // 再ビルドが起きないまま成功として扱われ、サイトが黙って古いままになる。
  if ((response.FailedEntryCount ?? 0) > 0) {
    const [entry] = response.Entries ?? [];
    const reason = [entry?.ErrorCode, entry?.ErrorMessage].filter(Boolean).join(" ");
    throw new Error(`PutEvents rejected the crawl-completed event: ${reason || "unknown reason"}`);
  }
}
