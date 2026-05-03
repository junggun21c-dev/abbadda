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

  const { favs, favKeys, home, force, deleted } = req.body || {};
  const saves = [];
  const result = { ok: true, saved: {} };
  const isForce = !!force;

  // 찜 처리
  if (Array.isArray(favs)) {
    if (favs.length > 0) {
      // 정상 케이스: 비어있지 않은 favs는 그대로 저장
      saves.push(kvSet(`user:${sess.id}:favs`, JSON.stringify(favs)));
      result.saved.favs = favs.length;
    } else {
      // 빈 배열: force=true면 의도적 삭제로 간주, 그대로 저장. 아니면 보호
      if (isForce) {
        saves.push(kvSet(`user:${sess.id}:favs`, JSON.stringify([])));
        result.saved.favs = 0;
      } else {
        const existing = await kvGet(`user:${sess.id}:favs`);
        if (!existing) {
          result.saved.favs = 0;
        } else {
          // 의도치 않은 빈 배열 → 거부 (데이터 보호)
          console.warn(`[save] 빈 favs 거부 (userId: ${sess.id}, force=false)`);
          result.saved.favs = 'rejected_empty';
        }
      }
    }
  }

  // 동적 코스 안정 식별자(favKeys) 처리: favs와 동일한 빈 배열 보호 정책
  if (Array.isArray(favKeys)) {
    if (favKeys.length > 0) {
      saves.push(kvSet(`user:${sess.id}:favKeys`, JSON.stringify(favKeys)));
      result.saved.favKeys = favKeys.length;
    } else {
      if (isForce) {
        saves.push(kvSet(`user:${sess.id}:favKeys`, JSON.stringify([])));
        result.saved.favKeys = 0;
      } else {
        const existing = await kvGet(`user:${sess.id}:favKeys`);
        if (!existing) {
          result.saved.favKeys = 0;
        } else {
          console.warn(`[save] 빈 favKeys 거부 (userId: ${sess.id}, force=false)`);
          result.saved.favKeys = 'rejected_empty';
        }
      }
    }
  }

  // 출발지 처리
  if (home !== undefined) {
    if (home && home.addr) {
      saves.push(kvSet(`user:${sess.id}:home`, JSON.stringify(home)));
      result.saved.home = home.addr;
    } else {
      // null: force면 그대로 저장, 아니면 기존 데이터 보호
      if (isForce) {
        saves.push(kvSet(`user:${sess.id}:home`, JSON.stringify(null)));
        result.saved.home = null;
      } else {
        const existing = await kvGet(`user:${sess.id}:home`);
        if (existing) {
          console.warn(`[save] null home 거부 (userId: ${sess.id})`);
          result.saved.home = 'rejected_null';
        } else {
          result.saved.home = null;
        }
      }
    }
  }

  // 삭제 기록 저장 (다른 디바이스에서 부활 방지용).
  // 빈 배열은 force=true 시에만 비움 — 다른 디바이스의 기록을 우발적으로 잃지 않도록 보호.
  if (Array.isArray(deleted)) {
    if (deleted.length > 0) {
      saves.push(kvSet(`user:${sess.id}:deleted`, JSON.stringify(deleted)));
      result.saved.deleted = deleted.length;
    } else if (isForce) {
      saves.push(kvSet(`user:${sess.id}:deleted`, JSON.stringify([])));
      result.saved.deleted = 0;
    }
  }

  await Promise.all(saves);
  return res.status(200).json(result);
}
