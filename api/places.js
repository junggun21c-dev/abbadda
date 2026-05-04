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

  // contentTypeId=28(레포츠)는 골프장·경마장 등 성인 시설 비중이 커서 제외
  // 12(관광지)·14(문화시설)만 사용해 가족 친화 데이터로 한정
  const CONTENT_TYPES = [
    { id: 12, cat: '실외', tags: ['관광지', '자연', '아이추천'], emoji: '🏞️' },
    { id: 14, cat: '실내', tags: ['문화시설', '박물관', '교육'], emoji: '🏛️' },
  ];

  // 가족·아이 부적합 장소 차단 (골프·성인·도박·유흥 등)
  const NOT_FAMILY_FRIENDLY = /골프|GOLF|컨트리클럽|CC| GC$|경마|경륜|경정|카지노|사격|성인|에로|어른전용|룸살롱|나이트클럽|유흥|단란|안마|찜질방|모텔|호텔|묘역|묘지|묘소|묘원|묘비|봉안|납골|화장장|영안실|추모공원|추모관/i;

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
      })).filter((p) => p.lat && p.lng && p.title && !NOT_FAMILY_FRIENDLY.test(p.title));
    } catch {
      return [];
    }
  };

  const results = await Promise.all(CONTENT_TYPES.map(fetchType));
  const items = [].concat(...results);

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.json({ items });
}
