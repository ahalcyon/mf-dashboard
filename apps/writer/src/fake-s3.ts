import { Readable } from "node:stream";

/**
 * S3 の代わりに使うメモリ上のオブジェクトストア。
 *
 * writer が守っている不変条件は「何が書き戻されたか」で決まるので、
 * 呼び出しの記録ではなく**実際のバイト列**を持つ。アップロードされた
 * データベースを開き直して中身を確かめられるようにするための土台。
 */
export class FakeS3 {
  readonly objects = new Map<string, Buffer>();
  readonly puts: string[] = [];

  put(key: string, body: Buffer | string): void {
    this.objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
  }

  get(key: string): Buffer | undefined {
    return this.objects.get(key);
  }
}

export class FakeNoSuchKey extends Error {
  constructor() {
    super("NoSuchKey");
    this.name = "NoSuchKey";
  }
}

interface GetInput {
  Bucket: string;
  Key: string;
}

interface PutInput extends GetInput {
  Body: Buffer;
}

export type FakeCommand = { kind: "get"; input: GetInput } | { kind: "put"; input: PutInput };

function toBody(buffer: Buffer) {
  const stream = Readable.from([buffer]) as Readable & {
    transformToString: () => Promise<string>;
  };
  stream.transformToString = async () => buffer.toString("utf8");
  return stream;
}

export function createFakeS3Client(store: FakeS3) {
  return {
    async send(command: FakeCommand) {
      if (command.kind === "get") {
        const body = store.get(command.input.Key);
        // 実物と同じく、鍵が無いことは例外で伝える
        if (!body) throw new FakeNoSuchKey();
        return { Body: toBody(body) };
      }

      store.puts.push(command.input.Key);
      store.put(command.input.Key, command.input.Body);
      return {};
    },
    destroy() {},
  };
}
