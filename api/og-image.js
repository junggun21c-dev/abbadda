// 외부 페이지의 og:image 자동 추출 + 네이버 이미지 검색 fallback + KV 캐시
// 사용: <img src="/api/og-image?url=...&title=행사명">
// 행사 카드의 firstimage가 비어있을 때 자동 추출해 표시.
//
// 흐름:
// 1) ?url= + ?title= 받음
// 2) KV에서 og-image:{key} 캐시 확인 → 있으면 즉시 image stream
// 3) url 페이지에서 og:image / twitter:image 추출 시도
// 4) 실패 시 → 네이버 이미지 검색 (NAVER_CLIENT_ID/SECRET 필요, title 사용)
// 5) 모두 실패 → 1x1 transparent PNG (클라이언트가 emoji fallback)

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

// 네이버 이미지 검색 — title로 행사 대표 이미지 검색 (og:image 없는 사이트 fallback)
async function naverImageSearch(title) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret || !title) return null;
  try {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://openapi.naver.com/v1/search/image?query=${q}&display=5&sort=sim`, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const items = data.items || [];
    // pstatic.net 썸네일이 호스트 안정적 (hotlink 차단 없음)
    for (const it of items) {
      if (it.thumbnail) return it.thumbnail;
      if (it.link) return it.link;
    }
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, title } = req.query;
  if (!url && !title) return res.status(400).send('missing url or title');

  let parsed = null;
  if (url && typeof url === 'string') {
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) parsed = null;
    } catch {}
  }

  // 캐시 키: url 우선, 없으면 title (같은 title은 같은 이미지 공유)
  const cacheKey = `og-image:${hash(parsed ? url : `t:${title}`)}`;

  const sendPng = (status, png) => {
    const ttl = status === 200 ? 604800 : 86400;
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}`);
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(png);
  };
  const failFallback = async (msg) => {
    await kvSet(cacheKey, 'NONE', 86400).catch(() => {});
    return sendPng(404, TRANSPARENT_PNG);
  };

  // KV 캐시 조회
  let cachedImageUrl = null;
  try {
    cachedImageUrl = await kvGet(cacheKey);
  } catch {}

  if (cachedImageUrl === 'NONE') return sendPng(404, TRANSPARENT_PNG);

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

  // 1순위: url 페이지 og:image 추출
  let candidateImageUrl = null;
  if (parsed) {
    try {
      const pageResp = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (pageResp.ok) {
        const html = await pageResp.text();
        const ogImageRaw = extractOgImage(html);
        if (ogImageRaw) candidateImageUrl = resolveUrl(pageResp.url || url, ogImageRaw);
      }
    } catch {}
  }

  // 2순위: 네이버 이미지 검색 (title 사용, NAVER 환경변수 필요)
  if (!candidateImageUrl && title && typeof title === 'string') {
    candidateImageUrl = await naverImageSearch(title);
  }

  if (!candidateImageUrl) return failFallback('no candidate');

  // 이미지 fetch 후 stream
  const img = await fetchImage(candidateImageUrl);
  if (!img) return failFallback('image fetch failed');

  // 성공 → KV에 image URL 저장 (7일)
  await kvSet(cacheKey, candidateImageUrl, 7 * 86400).catch(() => {});
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
  res.setHeader('Content-Type', img.ct);
  return res.status(200).send(img.buf);
}
