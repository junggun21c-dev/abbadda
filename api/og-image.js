// 외부 페이지의 og:image 자동 추출 + KV 캐시 + 이미지 binary stream
// 사용: <img src="/api/og-image?url=https://news.gm.go.kr/news/articleView.html?idxno=24164">
// 행사 카드의 firstimage가 비어있을 때 행사 link에서 대표 이미지를 자동 추출해 표시.
//
// 흐름:
// 1) ?url= 받음 (행사 detail 페이지 URL)
// 2) KV에서 og-image:{md5} 캐시 확인 → 있으면 즉시 image stream
// 3) 없으면 url fetch → og:image / twitter:image 추출
// 4) 추출한 image URL을 fetch → binary stream (& KV에 image URL 저장, 7일)
// 5) 추출 실패 시 KV에 NONE 저장(1일 TTL) → 410 + transparent 1x1 PNG

import { kvGet, kvSet } from './_kv.js';
import { createHash } from 'crypto';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
// 1x1 투명 PNG (실패 시 폴백 — 클라이언트는 onerror로 emoji fallback 가능)
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function hash(s) {
  return createHash('md5').update(s).digest('hex');
}

function extractOgImage(html) {
  // 다양한 메타태그 패턴: property/name 모두 + 순서 무관
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function resolveUrl(base, target) {
  try {
    return new URL(target, base).toString();
  } catch {
    return target;
  }
}

async function fetchImage(imageUrl) {
  const r = await fetch(imageUrl, {
    headers: { 'User-Agent': UA, Referer: imageUrl },
    redirect: 'follow',
  });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return { ct, buf };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('missing url');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).send('invalid url');
  }
  if (!/^https?:$/.test(parsed.protocol)) return res.status(400).send('invalid protocol');

  const cacheKey = `og-image:${hash(url)}`;

  // KV 캐시 조회
  let cachedImageUrl = null;
  try {
    cachedImageUrl = await kvGet(cacheKey);
  } catch {}

  if (cachedImageUrl === 'NONE') {
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(TRANSPARENT_PNG);
  }

  // 캐시된 image URL이 있으면 그걸로 fetch
  if (cachedImageUrl && cachedImageUrl.startsWith('http')) {
    const img = await fetchImage(cachedImageUrl);
    if (img) {
      res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
      res.setHeader('Content-Type', img.ct);
      return res.status(200).send(img.buf);
    }
    // 캐시된 URL이 죽었으면 다시 추출 시도
  }

  // 페이지 fetch + og:image 추출
  try {
    const pageResp = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!pageResp.ok) {
      await kvSet(cacheKey, 'NONE', 86400).catch(() => {});
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(TRANSPARENT_PNG);
    }
    const html = await pageResp.text();
    const ogImageRaw = extractOgImage(html);
    if (!ogImageRaw) {
      await kvSet(cacheKey, 'NONE', 86400).catch(() => {});
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(TRANSPARENT_PNG);
    }
    const ogImageUrl = resolveUrl(pageResp.url || url, ogImageRaw);

    // 이미지 fetch 후 stream
    const img = await fetchImage(ogImageUrl);
    if (!img) {
      await kvSet(cacheKey, 'NONE', 86400).catch(() => {});
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(TRANSPARENT_PNG);
    }
    // 성공 → KV에 image URL 저장 (7일)
    await kvSet(cacheKey, ogImageUrl, 7 * 86400).catch(() => {});
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('Content-Type', img.ct);
    return res.status(200).send(img.buf);
  } catch (e) {
    await kvSet(cacheKey, 'NONE', 86400).catch(() => {});
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(TRANSPARENT_PNG);
  }
}
