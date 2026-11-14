const SLUG_LENGTH = 7;
const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SLUG_REGEX = /^[A-Za-z0-9_-]{3,32}$/;

// 共有データ (圧縮済み文字列) の最大長。これを超える保存要求は 413 で拒否する。
const MAX_SHARE_LENGTH = 256 * 1024;
// リクエストボディ全体の上限 ({"share":"..."} の JSON 包装ぶんの余裕を持たせる)
const MAX_BODY_BYTES = MAX_SHARE_LENGTH * 4 + 1024;

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  SHORT_KV: KVNamespace;
  ASSETS?: AssetFetcher;
  // 任意: wrangler.toml の [[ratelimits]] で束縛する。未設定ならレート制限なしで動く。
  SHARE_RATE_LIMITER?: RateLimiter;
  // 任意: 共有データの保存期間 (秒)。未設定または 60 未満なら無期限。
  SHARE_TTL_SECONDS?: string | number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function randomSlug(length = SLUG_LENGTH): string {
  // 暗号論的乱数を使い、剰余の偏りが出ないよう範囲外の値は捨てる
  const limit = 256 - (256 % SLUG_CHARS.length);
  const buffer = new Uint8Array(length * 2);
  let result = '';
  while (result.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      result += SLUG_CHARS[byte % SLUG_CHARS.length];
      if (result.length === length) break;
    }
  }
  return result;
}

async function generateUniqueSlug(env: Env): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = randomSlug();
    const exists = await env.SHORT_KV.get(`share:${slug}`);
    if (!exists) return slug;
  }
  return randomSlug(10);
}

function resolveShareTtl(env: Env): number | null {
  const ttl = Number(env.SHARE_TTL_SECONDS);
  // KV の expirationTtl は 60 秒以上が必要
  return Number.isFinite(ttl) && ttl >= 60 ? Math.floor(ttl) : null;
}

// ========= CORS 許可リスト =========
const allowedOrigins: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/himais0giiiin\.com$/,
  /^https?:\/\/([a-zA-Z0-9-]+\.)?himais0giiiin\.com$/,
  /^https?:\/\/beta\.himais0giiiin\.com$/,
  /^https?:\/\/([a-zA-Z0-9-]+\.)?edbb\.himaiso\.workers\.dev$/,
  /^https?:\/\/edbplugin\.github\.io$/,
];

// ========= CORS ヘッダ生成 =========
function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (origin && allowedOrigins.some((regex) => regex.test(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function respondJson(status: number, data: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors,
    },
  });
}

function respondText(status: number, message: string, cors: Record<string, string>): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      ...cors,
    },
  });
}

async function proxyAssets(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (env.ASSETS?.fetch) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse && assetResponse.status !== 404) {
      const headers = new Headers(assetResponse.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        headers,
      });
    }
  }
  return respondText(404, 'Not Found', cors);
}

function hasKv(env: Env): boolean {
  return !!env.SHORT_KV && typeof env.SHORT_KV.put === 'function' && typeof env.SHORT_KV.get === 'function';
}

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request);

    // ===== OPTIONS: CORSプリフライト =====
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors,
      });
    }

    // ===== 1. 短縮URL生成 =====
    if (request.method === 'POST' && url.pathname === '/share/create') {
      if (env.SHARE_RATE_LIMITER && typeof env.SHARE_RATE_LIMITER.limit === 'function') {
        const clientKey = request.headers.get('CF-Connecting-IP') || 'unknown';
        try {
          const { success } = await env.SHARE_RATE_LIMITER.limit({ key: clientKey });
          if (!success) {
            return respondJson(429, { error: 'リクエストが多すぎます。しばらく待ってから再試行してください' }, cors);
          }
        } catch (error) {
          // レート制限の障害で共有機能そのものを止めない
          console.error('Rate limiter failed', error);
        }
      }

      const declaredLength = Number(request.headers.get('Content-Length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        return respondJson(413, { error: '共有データが大きすぎます' }, cors);
      }

      let body: unknown;
      try {
        const rawBody = await request.text();
        if (rawBody.length > MAX_BODY_BYTES) {
          return respondJson(413, { error: '共有データが大きすぎます' }, cors);
        }
        body = JSON.parse(rawBody);
      } catch (error) {
        return respondJson(400, { error: 'JSON が不正です' }, cors);
      }

      const share = (body as Record<string, unknown>)?.share;
      if (!share || typeof share !== 'string') {
        return respondJson(400, { error: 'share は必須です' }, cors);
      }
      if (share.length > MAX_SHARE_LENGTH) {
        return respondJson(413, { error: '共有データが大きすぎます' }, cors);
      }

      if (!hasKv(env)) {
        return respondJson(503, { error: 'KV が設定されていません (SHORT_KV)' }, cors);
      }

      let slug: string;
      try {
        slug = await generateUniqueSlug(env);
        const ttl = resolveShareTtl(env);
        if (ttl) {
          await env.SHORT_KV.put(`share:${slug}`, share, { expirationTtl: ttl });
        } else {
          await env.SHORT_KV.put(`share:${slug}`, share);
        }
      } catch (error) {
        console.error('KV write failed', error);
        return respondJson(500, { error: '短縮 URL の生成に失敗しました' }, cors);
      }

      const shortUrl = `${url.origin}/${slug}`;
      return respondJson(200, { url: shortUrl }, cors);
    }

    // ===== 2. リダイレクト =====
    if (request.method === 'GET') {
      const path = url.pathname.replace(/^\/+/, '');
      const isSlugCandidate = SLUG_REGEX.test(path);

      if (isSlugCandidate) {
        if (!hasKv(env)) {
          return respondText(503, 'KV が設定されていません (SHORT_KV)', cors);
        }
        try {
          const share = await env.SHORT_KV.get(`share:${path}`);
          if (share) {
            const redirectUrl = `https://himais0giiiin.com/editor/?share=${encodeURIComponent(share)}`;
            return new Response(null, {
              status: 302,
              headers: {
                Location: redirectUrl,
                ...cors,
              },
            });
          }
        } catch (error) {
          console.error('KV read failed', error);
          return respondText(500, 'Internal Error', cors);
        }
      }

      // 静的アセットへフォールバック
      return proxyAssets(request, env, cors);
    }

    return respondText(404, 'Not Found', cors);
  },
};
