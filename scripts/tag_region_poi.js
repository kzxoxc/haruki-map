const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'places.csv');

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) { fields.push(cur); cur = ''; continue; }
    cur += c;
  }
  fields.push(cur);
  return fields;
}

function toCsvField(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function classifyRegion(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const inJapan = lat >= 24 && lat <= 46 && lng >= 122 && lng <= 148;
  if (!inJapan) return '해외';
  if (lat >= 41.0) return '홋카이도';
  if (lat < 34.2 && lng < 132.5) return '규슈';
  if (lat >= 33.8 && lat <= 35.3 && lng >= 134.6 && lng <= 136.3) return '간사이';
  if (lat >= 34.9 && lat <= 36.3 && lng >= 138.9 && lng <= 140.3) return '간토';
  return '기타';
}

// 좌표가 없는 6건은 주소/작품 맥락으로 수동 분류 (region 컬럼 도입 시 소급 태깅)
const REGION_OVERRIDES = {
  '시나가와구 (시나가와 원숭이)': '간토',
  '아오야마도리(青山通り) (국경의 남쪽, 태양의 서쪽)': '간토',
  '고치현 (해변의 카프카)': '기타',
  '아이즈(会津) 지역, 후쿠시마현 (도시와 그 불확실한 벽)': '기타',
  '아테네-마라톤 원조 코스 (달리기를 말할 때 내가 하고 싶은 이야기)': '해외',
  '사로마호(サロマ湖) 100km 울트라마라톤 코스': '홋카이도',
};

// 지금도 실제 영업 중인 식당·카페·바로 확인된 항목만 (2026-07-28 조사 기준)
const POI_TYPE_WHITELIST = new Set([
  '토아로드 델리카테센 (댄스 댄스 댄스)',
  'cafe 螢明舎(케이메이샤) 야즈점',
  '피노키오(ピノッキオ) (헨쿄・킨쿄 에세이)',
  '아 쿠카냐(A Cuccagna), 팔레르모 (먼 북소리)',
  'FiGARO (댄스 댄스 댄스)',
]);

const raw = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = raw.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]);

if (header.includes('region')) {
  console.error('region 컬럼이 이미 존재합니다. 스크립트를 다시 실행하지 마세요.');
  process.exit(1);
}

const latIdx = header.indexOf('lat');
const lngIdx = header.indexOf('lng');
const nameIdx = header.indexOf('name');

const newHeader = [...header, 'region', 'poi_type'];
const outLines = [newHeader.map(toCsvField).join(',')];

let missingRegion = 0;
for (const line of lines.slice(1)) {
  const fields = parseCsvLine(line);
  const name = fields[nameIdx];
  const lat = fields[latIdx] ? parseFloat(fields[latIdx]) : null;
  const lng = fields[lngIdx] ? parseFloat(fields[lngIdx]) : null;

  let region = classifyRegion(lat, lng);
  if (region == null) {
    region = REGION_OVERRIDES[name] || null;
  }
  if (region == null) {
    missingRegion++;
    console.warn('region 미분류:', name);
  }

  const poiType = POI_TYPE_WHITELIST.has(name) ? '식당카페' : '';

  const newFields = [...fields, region || '', poiType];
  outLines.push(newFields.map(toCsvField).join(','));
}

if (missingRegion > 0) {
  console.error(`${missingRegion}건이 region 미분류 상태입니다. REGION_OVERRIDES를 보강하세요.`);
  process.exit(1);
}

fs.writeFileSync(CSV_PATH, outLines.join('\r\n') + '\r\n', 'utf-8');
console.log(`완료: ${outLines.length - 1}행에 region/poi_type 추가.`);
