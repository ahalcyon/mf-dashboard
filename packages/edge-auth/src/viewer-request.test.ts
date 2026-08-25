import { describe, expect, test } from "vitest";
import {
  buildRequest,
  DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS,
  isResponse,
  loadViewerRequest,
  type CloudFrontResponse,
} from "./load-viewer-request.js";

const SESSION = "session-token-value";
const AUTHORIZATION = "Basic dXNlci1hOnBhc3N3b3Jk";

function withCredentials(overrides: Parameters<typeof loadViewerRequest>[0] = {}) {
  return loadViewerRequest({
    store: { session: SESSION, authorization: AUTHORIZATION },
    ...overrides,
  });
}

describe("認証のデシジョンテーブル", () => {
  test("クッキーが session と一致すれば通す", async () => {
    const handler = withCredentials();

    const result = await handler({
      request: buildRequest({ uri: "/cf/", cookies: { chv: { value: SESSION } } }),
    });

    expect(isResponse(result)).toBe(false);
    expect(result).toMatchObject({ uri: "/cf/index.html" });
  });

  test("クッキーが一致しなくても Basic が一致すれば 302 でクッキーを焼く", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({
        uri: "/cf/",
        headers: { authorization: { value: AUTHORIZATION } },
      }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(302);
    expect(result.headers.location.value).toBe("/cf/");
    expect(result.cookies?.chv.value).toBe(SESSION);
    expect(result.headers["cache-control"].value).toBe("no-store");
  });

  test("クッキーが誤っていても Basic が一致すれば 302 になる", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({
        cookies: { chv: { value: "forged" } },
        headers: { authorization: { value: AUTHORIZATION } },
      }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(302);
  });

  test("クッキーも Basic も無ければ 401 を返す", async () => {
    const handler = withCredentials();

    const result = (await handler({ request: buildRequest() })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
    expect(result.headers["www-authenticate"].value).toBe('Basic realm="mf-dashboard"');
    expect(result.headers["cache-control"].value).toBe("no-store");
  });

  test("Basic が誤っていれば 401 を返す", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({ headers: { authorization: { value: "Basic d3Jvbmc6d3Jvbmc=" } } }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
  });

  test("偽のクッキーだけでは 401 を返す", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({ cookies: { chv: { value: "forged" } } }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
  });
});

describe("フェイルクローズ", () => {
  test("session が引けなければ、正しい Basic でも通さない", async () => {
    const handler = loadViewerRequest({
      store: { authorization: AUTHORIZATION },
      failingKeys: ["session"],
    });

    const result = (await handler({
      request: buildRequest({ headers: { authorization: { value: AUTHORIZATION } } }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
  });

  test("session が空文字なら誰も通さない", async () => {
    const handler = loadViewerRequest({ store: { session: "", authorization: AUTHORIZATION } });

    const result = (await handler({
      request: buildRequest({ cookies: { chv: { value: "" } } }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
  });

  test("authorization が引けなければ Basic を通さない", async () => {
    const handler = loadViewerRequest({
      store: { session: SESSION },
      failingKeys: ["authorization"],
    });

    const result = (await handler({
      request: buildRequest({ headers: { authorization: { value: AUTHORIZATION } } }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
  });

  test("KeyValueStore が空なら誰も通さない", async () => {
    const handler = loadViewerRequest({ store: {} });

    const result = (await handler({
      request: buildRequest({ headers: { authorization: { value: AUTHORIZATION } } }),
    })) as CloudFrontResponse;

    expect(result.statusCode).toBe(401);
  });
});

describe("ディレクトリインデックスの書き換え", () => {
  test.for([
    ["/", "/index.html"],
    ["/cf/", "/cf/index.html"],
    ["/cf/2026-07", "/cf/2026-07/index.html"],
    ["/groups/group-a/", "/groups/group-a/index.html"],
  ])("%s を %s へ書き換える", async ([uri, expected]) => {
    const handler = withCredentials();

    const result = await handler({
      request: buildRequest({ uri, cookies: { chv: { value: SESSION } } }),
    });

    expect(result).toMatchObject({ uri: expected });
  });

  test.for(["/logo.png", "/manifest.webmanifest", "/export/assets.json", "/_next/static/chunk.js"])(
    "拡張子付きの %s はそのまま通す",
    async (uri) => {
      const handler = withCredentials();

      const result = await handler({
        request: buildRequest({ uri, cookies: { chv: { value: SESSION } } }),
      });

      expect(result).toMatchObject({ uri });
    },
  );

  // /api/* は refresh-trigger Lambda が処理する。index.html を足すと届かない。
  test.for(["/api/refresh/", "/api/refresh", "/api/"])(
    "%s には index.html を足さない",
    async (uri) => {
      const handler = withCredentials();

      const result = await handler({
        request: buildRequest({ uri, cookies: { chv: { value: SESSION } } }),
      });

      expect(result).toMatchObject({ uri });
    },
  );
});

describe("302 の戻り先", () => {
  test("クエリ文字列を保持する", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({
        uri: "/cf/",
        querystring: { month: { value: "2026-07" }, tab: { value: "expense" } },
        headers: { authorization: { value: AUTHORIZATION } },
      }),
    })) as CloudFrontResponse;

    expect(result.headers.location.value).toBe("/cf/?month=2026-07&tab=expense");
  });

  test("クエリ文字列をエスケープする", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({
        uri: "/search/",
        querystring: { q: { value: "a&b=c d" } },
        headers: { authorization: { value: AUTHORIZATION } },
      }),
    })) as CloudFrontResponse;

    expect(result.headers.location.value).toBe("/search/?q=a%26b%3Dc%20d");
  });

  test("クエリが無ければ URI だけを返す", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({
        uri: "/cf/",
        headers: { authorization: { value: AUTHORIZATION } },
      }),
    })) as CloudFrontResponse;

    expect(result.headers.location.value).toBe("/cf/");
  });

  // 302 の時点では書き換え前の URI を返す。書き換えは再訪時に行われる。
  test("index.html を付けずに元の URI へ戻す", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({
        uri: "/cf/2026-07",
        headers: { authorization: { value: AUTHORIZATION } },
      }),
    })) as CloudFrontResponse;

    expect(result.headers.location.value).toBe("/cf/2026-07");
  });
});

describe("セッションクッキーの属性", () => {
  test("terraform が渡す Max-Age を反映する", async () => {
    const handler = withCredentials({ sessionCookieMaxAgeSeconds: 604800 });

    const result = (await handler({
      request: buildRequest({ headers: { authorization: { value: AUTHORIZATION } } }),
    })) as CloudFrontResponse;

    expect(result.cookies?.chv.attributes).toBe(
      "Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800",
    );
  });

  test("既定値でも属性の並びは変わらない", async () => {
    const handler = withCredentials();

    const result = (await handler({
      request: buildRequest({ headers: { authorization: { value: AUTHORIZATION } } }),
    })) as CloudFrontResponse;

    expect(result.cookies?.chv.attributes).toBe(
      `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS}`,
    );
  });
});
