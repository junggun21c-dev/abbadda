// Kakao Daum 이미지 검색 프록시
// 카카오 Places API는 이미지를 안 주므로, 장소명으로 다음 이미지 검색을 호출해 대표 이미지 URL 반환
// 환경변수: KAKAO_REST_KEY (Kakao Developers 콘솔 → 앱 → 앱 키 → REST API 키)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name || typeof name !== 'string' || name.length < 2) {
    return res.status(400).json({ url: null, error: 'invalid name' });
  }

  // 환경변수 우선, 없으면 하드코딩 폴백 (다른 API 키들과 동일 정책)
  const KEY = process.env.KAKAO_REST_KEY || '50386ea3f9addcd7a8fa9762625aa441';

  // 7일 CDN 캐시 + 24시간 stale-while-revalidate (장소 이미지는 거의 변하지 않음)
  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');

  try {
    const url = `https://dapi.kakao.com/v2/search/image?query=${encodeURIComponent(name)}&size=10&sort=accuracy`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `KakaoAK ${KEY}` }
    });
    if (!resp.ok) {
      return res.json({ url: null, error: `kakao ${resp.status}` });
    }
    const data = await resp.json();
    const docs = data.documents || [];
    if (docs.length === 0) return res.json({ url: null });

    // 첫 결과 우선이지만 너무 작은 이미지(100×100 이하)는 스킵
    const valid = docs.find(d =>
      d.image_url
      && (!d.width || d.width >= 200)
      && (!d.height || d.height >= 200)
    ) || docs[0];

    // hotlink 차단 가능성 있는 도메인은 자동으로 /api/img 프록시 경유
    // (NAVER 블로그 pstatic.net, Daum 카페 등은 외부 referer 차단)
    const wrap = (u) => {
      if (!u) return null;
      const HOTLINK_RISKY = /(?:postfiles\.pstatic\.net|cafe\.daum\.net|t\d+\.daumcdn\.net|tistory\.com)/i;
      return HOTLINK_RISKY.test(u) ? `/api/img?url=${encodeURIComponent(u)}` : u;
    };

    return res.json({
      url: wrap(valid.image_url || valid.thumbnail_url || null),
      thumb: wrap(valid.thumbnail_url || null),
    });
  } catch (e) {
    return res.json({ url: null, error: e.message });
  }
}
