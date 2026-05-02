import { kvGet, kvSet } from '../_kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'no_token' });

  const sessRaw = await kvGet(`sess:${token}`);
  if (!sessRaw) return res.status(401).json({ error: 'invalid_session' });

  let sess;
  try { sess = JSON.parse(sessRaw); } catch { return res.status(401).json({ error: 'bad_session' }); }

  const { favs, home } = req.body || {};
  const saves = [];
  const result = { ok: true, saved: {} };

  // 찜: 빈 배열로 덮어쓰기 방지 (실수로 favs가 비워진 경우 보호)
  // 단, 명시적으로 [] 를 보낸 경우 = 사용자가 전체 삭제했을 가능성 → 기존 데이터 확인 후 결정
  if (Array.isArray(favs)) {
    if (favs.length > 0) {
      // 정상 케이스: 클라이언트의 favs를 그대로 저장
      saves.push(kvSet(`user:${sess.id}:favs`, JSON.stringify(favs)));
      result.saved.favs = favs.length;
    } else {
      // 빈 배열: 기존 서버 데이터가 있으면 덮어쓰지 않음 (안전 우선)
      const existing = await kvGet(`user:${sess.id}:favs`);
      if (!existing) {
        // 서버도 비어있으면 저장 안함 (의미 없음)
        result.saved.favs = 0;
      } else {
        // 서버에 데이터가 있는데 빈 배열이 들어오면 → 의도치 않은 데이터 손실 가능 → 거부
        console.warn(`[save] 빈 favs 거부 (userId: ${sess.id}, 기존 데이터 있음)`);
        result.saved.favs = 'rejected_empty';
      }
    }
  }

  // 출발지: null로 덮어쓰기 방지
  if (home !== undefined) {
    if (home && home.addr) {
      saves.push(kvSet(`user:${sess.id}:home`, JSON.stringify(home)));
      result.saved.home = home.addr;
    } else {
      // null이거나 addr 없음 → 서버에 기존 데이터가 있으면 보호
      const existing = await kvGet(`user:${sess.id}:home`);
      if (existing) {
        console.warn(`[save] null home 거부 (userId: ${sess.id})`);
        result.saved.home = 'rejected_null';
      } else {
        result.saved.home = null;
      }
    }
  }

  await Promise.all(saves);
  return res.status(200).json(result);
}
