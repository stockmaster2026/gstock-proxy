// gstock-proxy — Jasmine 專屬 CORS 代理
// 用法: https://gstock-proxy.cykjas.workers.dev/?url=<encodeURIComponent 過的目標網址>
// 設計重點: 錯誤絕不吞掉, 每種失敗都回不同的 error 代碼, 方便診斷

const ALLOWED_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request) {
    // 瀏覽器 preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return json({ error: "only_get_allowed", method: request.method }, 405);
    }

    const requestUrl = new URL(request.url);

    // 健康檢查: 直接開 /health 看代理活著沒
    if (requestUrl.pathname === "/health") {
      return json({ ok: true, worker: "gstock-proxy", allowed: ALLOWED_HOSTS }, 200);
    }

    const target = requestUrl.searchParams.get("url");
    if (!target) {
      return json({
        error: "missing_url_param",
        hint: "網址後面要加 ?url= 加上編碼過的目標網址",
      }, 400);
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return json({ error: "invalid_url", got: target }, 400);
    }

    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return json({
        error: "host_not_allowed",
        host: targetUrl.hostname,
        allowed: ALLOWED_HOSTS,
      }, 403);
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      const body = await upstream.text();

      // 上游非 200 也照樣把內容送回去, 但標記出來
      return new Response(body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
          "X-Upstream-Status": String(upstream.status),
          "X-Upstream-Host": targetUrl.hostname,
          ...CORS_HEADERS,
        },
      });
    } catch (err) {
      return json({
        error: "upstream_fetch_failed",
        host: targetUrl.hostname,
        detail: String(err),
      }, 502);
    }
  },
};
