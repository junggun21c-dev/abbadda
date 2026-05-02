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

  if (favs !== undefined) {
    saves.push(kvSet(`user:${sess.id}:favs`, JSON.stringify(favs)));
  }
  if (home !== undefined) {
    saves.push(kvSet(`user:${sess.id}:home`, JSON.stringify(home)));
  }

  await Promise.all(saves);
  return res.status(200).json({ ok: true });
}
