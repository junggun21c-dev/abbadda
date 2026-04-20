export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SEOUL_KEY = '6a7a54434f6a756e38375463465563';
  const TOUR_KEY = '7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95';
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayCompact = todayStr.replace(/-/g, '');

  // 6개월 전 시작일 (진행중인 장기 행사 포함)
  const past = new Date(now); past.setDate(past.getDate() - 180);
  const startFrom = past.toISOString().slice(0,10).replace(/-/g,'');

  const { areaCodes } = req.query;
  const codes = (areaCodes || '1,31').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);

  const seen = new Set();
  const allItems = [];

  // ── 1) 서울 열린데이터 문화행사 API (서울 거주자 포함 시 항상 호출) ──
  const fetchSeoul = async () => {
    try {
      const url = `http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/json/culturalEventInfo/1/1000/`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const rows = data?.culturalEventInfo?.row || [];
      for (const row of rows) {
        const endDate = (row.END_DATE || '').slice(0, 10);
        const startDate = (row.STRTDATE || '').slice(0, 10);
        if (!endDate || endDate < todayStr) continue;
        const key = 'seoul_' + row.TITLE + startDate;
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push({
          title: row.TITLE,
          eventstartdate: startDate.replace(/-/g, ''),
          eventenddate: endDate.replace(/-/g, ''),
          addr1: `서울 ${row.GUNAME || ''} ${row.PLACE || ''}`.trim(),
          mapy: row.LAT || null,
          mapx: row.LOT || null,
          contentid: `seoul_${seen.size}`,
          firstimage: row.MAIN_IMG || '',
          url: row.HMPG_ADDR || row.ORG_LINK || '',
          usefee: row.USE_FEE || '',
          usetimefestival: row.PRO_TIME || '',
          codename: row.CODENAME || '',
        });
      }
    } catch {}
  };

  // ── 2) 한국관광공사 TourAPI 전국 축제/행사 (지역코드별 병렬 호출) ──
  const fetchTour = async (code) => {
    try {
      const url = `https://apis.data.go.kr/B551011/KorService2/searchFestival2?serviceKey=${TOUR_KEY}&numOfRows=100&pageNo=1&MobileOS=ETC&MobileApp=abbadda&_type=json&arrange=A&eventStartDate=${startFrom}&areaCode=${code}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const items = data?.response?.body?.items?.item;
      if (!items) return;
      const arr = Array.isArray(items) ? items : [items];
      for (const item of arr) {
        const endDate = String(item.eventenddate || '');
        if (endDate.length === 8 && endDate < todayCompact) continue;
        const key = 'tour_' + (item.contentid || item.title + item.eventstartdate);
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push({
          title: item.title || '',
          eventstartdate: String(item.eventstartdate || ''),
          eventenddate: String(item.eventenddate || ''),
          addr1: item.addr1 || '',
          mapy: item.mapy || null,
          mapx: item.mapx || null,
          contentid: item.contentid || key,
          firstimage: item.firstimage || '',
          url: '',
          usefee: '',
          usetimefestival: '',
          codename: '축제', // TourAPI searchFestival2는 모두 축제
        });
      }
    } catch {}
  };

  // 병렬 호출
  try {
    const tasks = [fetchSeoul()];
    // 서울(1) 코드는 서울 API로 커버하므로 TourAPI에서는 서울 외 지역만
    const tourCodes = codes.filter(c => c !== '1');
    for (const code of tourCodes) tasks.push(fetchTour(code));
    // 서울 거주자도 경기 행사 보여주기 위해 31은 항상 포함
    if (!tourCodes.includes('31')) tasks.push(fetchTour('31'));
    await Promise.all(tasks);
  } catch(e) {
    return res.status(200).json({ items: [], total: 0, error: e.message });
  }

  // 진행중 축제 → 진행중 기타 → 예정 축제 → 예정 기타 순으로 정렬
  allItems.sort((a, b) => {
    const aStart = a.eventstartdate, aEnd = a.eventenddate;
    const bStart = b.eventstartdate, bEnd = b.eventenddate;
    const aOngoing = aStart <= todayCompact && aEnd >= todayCompact ? 0 : 1;
    const bOngoing = bStart <= todayCompact && bEnd >= todayCompact ? 0 : 1;
    const aFestival = (a.codename || '').includes('축제') ? 0 : 1;
    const bFestival = (b.codename || '').includes('축제') ? 0 : 1;
    // 진행중 여부 우선, 그 안에서 축제 우선
    if (aOngoing !== bOngoing) return aOngoing - bOngoing;
    if (aFestival !== bFestival) return aFestival - bFestival;
    return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
  });

  return res.status(200).json({ items: allItems, total: allItems.length });
}
