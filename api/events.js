export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SEOUL_KEY = '6a7a54434f6a756e38375463465563';
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // "2026-04-20"

  const seen = new Set();
  const allItems = [];

  // 서울 열린데이터 문화행사 API - 1000건 조회 후 진행중/예정 필터
  try {
    const url = `http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/json/culturalEventInfo/1/1000/`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      const rows = data?.culturalEventInfo?.row || [];

      for (const row of rows) {
        const endDate = (row.END_DATE || '').slice(0, 10);
        const startDate = (row.STRTDATE || '').slice(0, 10);
        if (!endDate || endDate < todayStr) continue; // 종료된 행사 제외

        const key = row.TITLE + startDate;
        if (seen.has(key)) continue;
        seen.add(key);

        // TourAPI 호환 포맷으로 변환
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
    }
  } catch(e) {
    return res.status(200).json({ items: [], total: 0, error: e.message });
  }

  return res.status(200).json({ items: allItems, total: allItems.length });
}
