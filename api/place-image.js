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

  const KEY = process.env.KAKAO_REST_KEY;
  if (!KEY) {
    return res.status(500).json({ url: null, error: 'KAKAO_REST_KEY env not set' });
  }

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

    return res.json({
      url: valid.image_url || valid.thumbnail_url || null,
      thumb: valid.thumbnail_url || null,
    });
  } catch (e) {
    return res.json({ url: null, error: e.message });
  }
}
