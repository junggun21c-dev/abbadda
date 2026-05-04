// 외부 이미지 hotlink 우회 프록시
// NAVER pstatic, Daum cafe 등 외부 사이트 임베드를 차단하는 도메인의 이미지를
// 서버가 fetch 후 클라이언트로 stream — 카카오 Daum 이미지 검색 결과 표시용

// 화이트리스트: 카카오 Daum 검색이 반환할 수 있는 신뢰 가능한 이미지 호스트만 허용
// 임의 URL을 프록시하지 않도록 제한 (오픈 프록시 악용 방지)
const ALLOWED_HOSTS = /^(postfiles\.pstatic\.net|[a-z0-9-]+\.pstatic\.net|[a-z0-9-]+\.cafe\.daum\.net|pds\d*\.cafe\.daum\.net|t\d+\.daumcdn\.net|i\d*\.daumcdn\.net|[a-z0-9-]+\.naver\.com|[a-z0-9-]+\.naver\.net|[a-z0-9-]+\.kakaocdn\.net|[a-z0-9-]+\.tistory\.com|t\d+\.daumcdn\.net|search\d*\.pstatic\.net)$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('missing url');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).send('invalid url');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return res.status(400).send('invalid protocol');
  }
  if (!ALLOWED_HOSTS.test(parsed.hostname)) {
    return res.status(403).send('host not allowed');
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        // Referer 의도적으로 설정하지 않음 — 일부 호스트는 같은 도메인 referer만 허용
      },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send(`upstream ${upstream.status}`);
    }
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) {
      return res.status(415).send('not an image');
    }
    // 7일 CDN 캐시 (이미지는 거의 안 변함)
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400, max-age=86400');
    res.setHeader('Content-Type', ct);
    const buf = await upstream.arrayBuffer();
    res.status(200).send(Buffer.from(buf));
  } catch (e) {
    res.status(500).send('proxy error');
  }
}
