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

  // 지역코드 → 시도명 (공공데이터포털 표준데이터 필터용)
  const AREA_TO_SIDO = {
    '1': '서울특별시', '2': '인천광역시', '3': '대전광역시',
    '4': '대구광역시', '5': '광주광역시', '6': '부산광역시',
    '7': '울산광역시', '8': '세종특별자치시', '31': '경기도',
    '32': '강원특별자치도', '33': '충청북도', '34': '충청남도',
    '35': '경상북도', '36': '경상남도', '37': '전북특별자치도',
    '38': '전라남도', '39': '제주특별자치도',
  };

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
        const place = row.PLACE || '';
        allItems.push({
          title: row.TITLE,
          eventstartdate: startDate.replace(/-/g, ''),
          eventenddate: endDate.replace(/-/g, ''),
          addr1: `서울 ${row.GUNAME || ''} ${place}`.trim(),
          mapy: row.LAT || null,
          mapx: row.LOT || null,
          contentid: `seoul_${seen.size}`,
          firstimage: row.MAIN_IMG || '',
          url: row.HMPG_ADDR || row.ORG_LINK || '',
          usefee: row.USE_FEE || '',
          usetimefestival: row.PRO_TIME || '',
          codename: row.CODENAME || '',
          isDDP: place.includes('DDP') || place.includes('동대문디자인플라자') || place.includes('동대문 디자인플라자'),
        });
      }
    } catch {}
  };

  // ── 2) 한국관광공사 TourAPI 전국 축제/행사 (지역코드별 병렬 호출) ──
  const fetchTour = async (code) => {
    try {
      const url = `https://apis.data.go.kr/B551011/KorService2/searchFestival2?serviceKey=${TOUR_KEY}&numOfRows=1000&pageNo=1&MobileOS=ETC&MobileApp=abbadda&_type=json&arrange=A&eventStartDate=${startFrom}&areaCode=${code}`;
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
          url: item.contentid ? `https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=${item.contentid}` : '',
          usefee: '',
          usetimefestival: '',
          codename: '축제',
        });
      }
    } catch {}
  };

  // ── 부산 자체 API: USAGE_DAY_WEEK_AND_TIME 자유 텍스트 → YYYYMMDD 추출 ──
  const parseBusanDate = (text) => {
    if (!text) return null;
    let m = text.match(/(\d{4})\.\s*(\d{1,2})\.?\s*(\d{1,2})\.?\s*[~∼\-]\s*(?:(\d{4})\.\s*)?(\d{1,2})\.?\s*(\d{1,2})/);
    if (m) {
      const sy = m[1], sm = m[2].padStart(2,'0'), sd = m[3].padStart(2,'0');
      const ey = m[4] || sy, em = m[5].padStart(2,'0'), ed = m[6].padStart(2,'0');
      return { startDate: `${sy}${sm}${sd}`, endDate: `${ey}${em}${ed}` };
    }
    m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[^~∼\-]*[~∼\-]\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) {
      const sy = m[1], sm = m[2].padStart(2,'0'), sd = m[3].padStart(2,'0');
      const ey = m[4] || sy, em = m[5].padStart(2,'0'), ed = m[6].padStart(2,'0');
      return { startDate: `${sy}${sm}${sd}`, endDate: `${ey}${em}${ed}` };
    }
    m = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (m) {
      const d = `${m[1]}${m[2].padStart(2,'0')}${m[3].padStart(2,'0')}`;
      return { startDate: d, endDate: d };
    }
    m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) {
      const d = `${m[1]}${m[2].padStart(2,'0')}${m[3].padStart(2,'0')}`;
      return { startDate: d, endDate: d };
    }
    return null;
  };

  // ── 3) 부산광역시 부산축제정보 API (부산 areaCode=6 요청 시 보강) ──
  const fetchBusan = async () => {
    if (!codes.includes('6')) return;
    try {
      const url = `https://apis.data.go.kr/6260000/FestivalService/getFestivalKr?serviceKey=${TOUR_KEY}&pageNo=1&numOfRows=200&resultType=json`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const items = data?.getFestivalKr?.item;
      if (!items) return;
      const arr = Array.isArray(items) ? items : [items];
      for (const item of arr) {
        const rawTitle = item.MAIN_TITLE || '';
        const title = rawTitle.replace(/\s*\([\s가-힣,영중간번일]+\)\s*$/, '').trim();
        if (!title) continue;
        const dates = parseBusanDate(item.USAGE_DAY_WEEK_AND_TIME || '');
        if (!dates) continue;
        if (dates.endDate.length === 8 && dates.endDate < todayCompact) continue;
        const key = 'busan_' + (item.UC_SEQ || title + dates.startDate);
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push({
          title,
          eventstartdate: dates.startDate,
          eventenddate: dates.endDate,
          addr1: (item.ADDR1 || `부산광역시 ${item.GUGUN_NM || ''} ${item.MAIN_PLACE || item.PLACE || ''}`).trim(),
          mapy: item.LAT || null,
          mapx: item.LNG || null,
          contentid: key,
          firstimage: item.MAIN_IMG_NORMAL || item.MAIN_IMG_THUMB || '',
          url: item.HOMEPAGE_URL || '',
          usefee: item.USAGE_AMOUNT || '',
          usetimefestival: item.USAGE_DAY_WEEK_AND_TIME || '',
          codename: '축제',
        });
      }
    } catch {}
  };

  // ── 4) 전국문화축제표준데이터 (공공데이터포털 · 지자체 소규모 축제 보완) ──
  // 지역 필터 파라미터 미지원 → 전체 1,269건을 2페이지로 병렬 fetch, insttNm으로 지역 필터
  const fetchPublicFestival = async () => {
    const sidos = [...new Set(codes.map(c => AREA_TO_SIDO[c]).filter(Boolean))];
    if (sidos.length === 0) return;
    try {
      const pageResults = await Promise.all([1, 2].map(pageNo =>
        fetch(`https://api.data.go.kr/openapi/tn_pubr_public_cltur_fstvl_api?serviceKey=${TOUR_KEY}&pageNo=${pageNo}&numOfRows=1000&type=json`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      ));
      for (const data of pageResults) {
        const items = data?.response?.body?.items;
        if (!items) continue;
        const arr = Array.isArray(items) ? items : [items];
        // 지역 필터: 주소(rdnmadr/lnmadr) 또는 기관명(insttNm)에 시도명 포함 여부 검사
        const sidoShorts = sidos.map(s => s.slice(0, 2)); // '서울특별시' → '서울', '경기도' → '경기' 등
        for (const item of arr) {
          const addrStr = [item.rdnmadr || '', item.lnmadr || '', item.insttNm || ''].join(' ');
          if (!sidoShorts.some(s => addrStr.includes(s))) continue;
          const endDate = String(item.fstvlEndDate || '').replace(/-/g, '');
          if (endDate.length === 8 && endDate < todayCompact) continue;
          const startDate = String(item.fstvlStartDate || '').replace(/-/g, '');
          const title = item.fstvlNm || '';
          if (!title) continue;
          const key = 'fstvl_' + title + startDate;
          if (seen.has(key)) continue;
          seen.add(key);
          allItems.push({
            title,
            eventstartdate: startDate,
            eventenddate: endDate,
            addr1: item.rdnmadr || item.lnmadr || '',
            mapy: item.latitude || null,
            mapx: item.longitude || null,
            contentid: key,
            firstimage: '',
            url: item.homepageUrl || '',
            usefee: '',
            usetimefestival: '',
            codename: '축제',
          });
        }
      }
    } catch {}
  };

  // 병렬 호출
  try {
    const tasks = [];
    if (codes.includes('1')) tasks.push(fetchSeoul());
    const tourCodes = codes.filter(c => c !== '1');
    for (const code of tourCodes) tasks.push(fetchTour(code));
    // 서울 포함 요청 시, 경기(31)가 없으면 추가
    if (codes.includes('1') && !tourCodes.includes('31')) tasks.push(fetchTour('31'));
    if (tasks.length === 0) tasks.push(fetchTour('1'));
    // 부산 자체 API: 부산(areaCode=6) 포함 시 보강
    tasks.push(fetchBusan());
    // 전국문화축제표준데이터: 요청 1회로 전체 fetch 후 지역 필터
    tasks.push(fetchPublicFestival());
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
    if (aOngoing !== bOngoing) return aOngoing - bOngoing;
    if (aFestival !== bFestival) return aFestival - bFestival;
    return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
  });

  return res.status(200).json({ items: allItems, total: allItems.length });
}
