import cf from 'cloudfront';

var kvs = cf.kvs();

async function read(key) {
  try {
    return await kvs.get(key);
  } catch (err) {
    return "";
  }
}

function unauthorized() {
  return {
    statusCode: 401,
    statusDescription: "Unauthorized",
    headers: {
      "www-authenticate": { value: 'Basic realm="mf-dashboard"' },
      "cache-control": { value: "no-store" }
    }
  };
}

function currentLocation(request) {
  var query = [];
  for (var name in request.querystring) {
    query.push(encodeURIComponent(name) + "=" + encodeURIComponent(request.querystring[name].value));
  }
  return query.length > 0 ? request.uri + "?" + query.join("&") : request.uri;
}

function rewriteIndex(request) {
  var uri = request.uri;
  // /api/* は Lambda が処理する。index.html を足すと届かなくなる。
  if (uri.startsWith("/api/")) {
    return request;
  }
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (!uri.split("/").pop().includes(".")) {
    request.uri = uri + "/index.html";
  }
  return request;
}

async function handler(event) {
  var request = event.request;

  // session が引けない場合は誰も通さない（フェイルクローズ）
  var session = await read("session");
  if (!session) {
    return unauthorized();
  }

  var cookie = request.cookies && request.cookies.chv ? request.cookies.chv.value : "";
  if (cookie === session) {
    return rewriteIndex(request);
  }

  var provided = request.headers.authorization ? request.headers.authorization.value : "";
  var expected = await read("authorization");
  if (!expected || provided !== expected) {
    return unauthorized();
  }

  // 初回だけ通る入口。ここでクッキーを焼き、以後ダイアログを出さない。
  return {
    statusCode: 302,
    statusDescription: "Found",
    headers: {
      location: { value: currentLocation(request) },
      "cache-control": { value: "no-store" }
    },
    cookies: {
      chv: {
        value: session,
        attributes: "Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${session_cookie_max_age_seconds}"
      }
    }
  };
}
