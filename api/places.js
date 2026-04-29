// TourAPI locationBasedList2 프록시
// 가족 나들이 적합 콘텐츠 타입: 12=관광지, 14=문화시설, 28=레포츠
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOUR_KEY = '7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95';
  const { lat, lng, radius = 20000, page = 1 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng required' });
  }

  const safeRadius = Math.min(Math.max(parseInt(radius, 10) || 20000, 1000), 20000);
  const safePage = Math.min(Math.max(parseInt(page, 10) || 1, 1), 20);

  const CONTENT_TYPES = [
    { id: 12, cat: '실외', tags: ['관광지', '자연', '아이추천'], emoji: '🏞️' },
    { id: 14, cat: '실내', tags: ['문화시설', '박물관', '교육'], emoji: '🏛️' },
    { id: 28, cat: '실외', tags: ['레포츠', '액티비티', '아이추천'], emoji: '🎯' },
  ];

  const fetchType = async (ct) => {
    try {
      const url = `https://apis.data.go.kr/B551011/KorService2/locationBasedList2?serviceKey=${TOUR_KEY}&numOfRows=30&pageNo=${safePage}&MobileOS=ETC&MobileApp=abbadda&_type=json&arrange=E&mapX=${lng}&mapY=${lat}&radius=${safeRadius}&contentTypeId=${ct.id}`;
      const resp = await fetch(url);
      if (!resp.ok) return [];
      const data = await resp.json();
      const items = data?.response?.body?.items?.item;
      if (!items) return [];
      const arr = Array.isArray(items) ? items : [items];
      return arr.map((p) => ({
        contentid: String(p.contentid || ''),
        title: p.title || '',
        addr: ((p.addr1 || '') + (p.addr2 ? ' ' + p.addr2 : '')).trim(),
        lat: parseFloat(p.mapy),
        lng: parseFloat(p.mapx),
        firstimage: p.firstimage || p.firstimage2 || '',
        tel: p.tel || '',
        contentTypeId: ct.id,
        cat: ct.cat,
        tags: ct.tags,
        emoji: ct.emoji,
      })).filter((p) => p.lat && p.lng && p.title);
    } catch {
      return [];
    }
  };

  const results = await Promise.all(CONTENT_TYPES.map(fetchType));
  const items = [].concat(...results);

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.json({ items });
}
