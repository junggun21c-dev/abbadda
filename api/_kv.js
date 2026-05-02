// Vercel KV (Upstash Redis) REST API 헬퍼
// 환경변수: KV_REST_API_URL, KV_REST_API_TOKEN (Vercel KV 연결 시 자동 주입)

const BASE  = () => process.env.KV_REST_API_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN;

async function kv(cmd) {
  const base = BASE(), token = TOKEN();
  if (!base || !token) return null;
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    const d = await r.json();
    return d.result ?? null;
  } catch { return null; }
}

export const kvGet = (key)              => kv(['GET', key]);
export const kvSet = (key, val, ex)    => ex ? kv(['SET', key, val, 'EX', ex]) : kv(['SET', key, val]);
export const kvDel = (key)             => kv(['DEL', key]);
export const kvExists = ()             => !!(BASE() && TOKEN());
