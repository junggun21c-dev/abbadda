// KV 환경변수 연결 상태 확인용 (임시 디버그 엔드포인트)
export default async function handler(req, res) {
  const keys = [
    'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL','KV_REST_API_TOKEN',
    'STORAGE_URL','STORAGE_TOKEN',
    'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN',
    'KV_URL','REDIS_URL',
  ];
  const found = keys.filter(k => !!process.env[k]);
  return res.status(200).json({ found, total: found.length });
}
