# 하루키 지도 사이트(Leaflet 실지도화) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `haruki_map.html`의 추상 SVG "개념도"를 실제 지리 좌표 기반 Leaflet+OpenStreetMap 지도로 교체한 `index.html`을 만들고, GitHub Pages(`https://kzxoxc.github.io/haruki-map/`)에 배포한다.

**Architecture:** 정적 단일 HTML 파일(`index.html`)에 Leaflet.js·PapaParse를 CDN으로 로드. `places.csv`를 런타임에 fetch해서 파싱하고, 기존 종이 테마 CSS·카드 UI는 그대로 재사용하며 지도 패널만 실제 좌표 기반 Leaflet 지도로 교체. `region`·`poi_type` 컬럼을 새로 추가해 필터를 확장한다.

**Tech Stack:** Vanilla HTML/CSS/JS, Leaflet.js(CDN), OpenStreetMap 타일, PapaParse(CDN), Node.js(1회성 데이터 마이그레이션 스크립트), Git/GitHub Pages.

## Global Constraints

- API 키·결제수단 등록 불필요 (Google Maps 대신 Leaflet+OSM 채택 — 스펙 결정사항)
- 기존 종이·잉크 테마 CSS와 필터·카드 UI 구조·동작 방식은 그대로 유지, 지도 패널만 교체 (스펙 "목표" 항목)
- `places.csv`는 런타임 fetch로 로드 — 하드코딩 배열 금지, CSV 갱신 시 재빌드 없이 반영돼야 함 (스펙 "아키텍처" 항목)
- 좌표(`lat`/`lng`)가 없는 행은 지도에 마커를 그리지 않되 카드 목록에는 표시 (스펙 "에러 처리" 항목)
- CSV fetch 실패 시 화면에 에러 메시지 표시, 콘솔 에러만으로 끝내지 않음 (스펙 "에러 처리" 항목)
- CSV 각 행 필드 수가 15개(기존 13 + `region` + `poi_type`)가 아니면 콘솔 경고 (스펙 "에러 처리" 항목)
- 좌표 추측 금지, 없는 출처 금지 등 CLAUDE.md 절대 규칙은 데이터 작업에도 적용 (스펙 "데이터 스키마 변경" 항목)

---

## File Structure

- **Create:** `scripts/tag_region_poi.js` — 1회성 Node 마이그레이션 스크립트 (places.csv에 region/poi_type 컬럼 추가)
- **Modify:** `places.csv` — 위 스크립트 실행 결과로 15컬럼으로 확장
- **Create:** `index.html` — `haruki_map.html`을 베이스로 복사한 뒤 지도·데이터로딩·필터 부분을 수정한 실제 배포 파일
- **Unchanged:** `haruki_map.html` — 예전 SVG 버전 스냅샷, 그대로 보존(참고용, 사이트에서 링크 안 함)

---

### Task 1: places.csv에 region/poi_type 컬럼 추가 (데이터 마이그레이션)

**Files:**
- Create: `scripts/tag_region_poi.js`
- Modify: `places.csv`

**Interfaces:**
- Produces: `places.csv`가 헤더 `name,lat,lng,address,category,work,evidence,evidence_grade,source_url,status,my_note,key_location,source_type,region,poi_type` (15컬럼)를 가짐. `region` 값은 `간토`/`간사이`/`홋카이도`/`규슈`/`기타`/`해외` 중 하나. `poi_type` 값은 `식당카페` 또는 빈 문자열.

- [ ] **Step 1: 마이그레이션 스크립트 작성**

`scripts/tag_region_poi.js` 생성:

```js
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
```

- [ ] **Step 2: 스크립트 실행**

Run: `node scripts/tag_region_poi.js`
Expected: `완료: 65행에 region/poi_type 추가.` 출력, exit code 0. `region 미분류` 경고가 하나라도 뜨면 `REGION_OVERRIDES`에 해당 `name`을 추가하고 재실행(단, 재실행 전에 `git checkout -- places.csv`로 되돌린 뒤 실행 — 스크립트가 이미 15컬럼이면 즉시 에러 종료하도록 만들어져 있음).

- [ ] **Step 3: 결과 검증**

Run:
```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('places.csv','utf-8').split(/\r?\n/).filter(Boolean);
console.log('rows:', lines.length);
console.log('header:', lines[0]);
const regionCounts = {};
lines.slice(1).forEach(l=>{
  const m = l.match(/,\"([^\"]*)\",\"([^\"]*)\"$/);
  if(m) regionCounts[m[1]] = (regionCounts[m[1]]||0)+1;
});
console.log(regionCounts);
"
```
Expected: `rows: 66` (헤더+65), header에 `region`,`poi_type` 포함, region별 건수 합이 65.

- [ ] **Step 4: Commit**

```bash
git add scripts/tag_region_poi.js places.csv
git commit -m "data: places.csv에 region/poi_type 컬럼 추가 (65건 소급 태깅)"
```

---

### Task 2: index.html 골격 생성 — CSV 런타임 로딩 + 카드 렌더링

**Files:**
- Create: `index.html` (`haruki_map.html` 복사 후 수정)

**Interfaces:**
- Produces: 전역 `let PLACES = []` (CSV 로드 후 채워짐, 각 원소는 `{name,lat,lng,address,category,work,evidence,grade,sources,status,my_note,key_location,source_type,region,poi_type,__idx}`), `async function loadPlaces()` (CSV fetch+파싱해서 PLACES 채우고 `init()` 호출)
- Consumes: 없음(최초 태스크)

- [ ] **Step 1: 파일 복사**

```bash
cp haruki_map.html index.html
```

- [ ] **Step 2: `<head>`에 CDN 스크립트 추가**

`index.html`에서 `<title>하루키 문학 지도 — 장소 아카이브</title>` 바로 다음 줄에 추가:

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js" integrity="sha512-YWEAJHtEfYNytZbo3AS1jY6UGuAWWCVCUYA8cxrCUgQxHYPo/qJXhkMy9EhZOoDvyLwSKzfMg8G7OTgSlP0kDA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
```

- [ ] **Step 3: 하드코딩된 PLACES 배열을 로더로 교체**

`const PLACES = [{"name":"Kyoto Hirogawara...` 로 시작해서 `}];` 로 끝나는 한 줄(현재 448번째 줄)을 찾아서 다음으로 교체:

```js
let PLACES = [];

async function loadPlaces(){
  const errBox = document.getElementById('loadError');
  try {
    const res = await fetch('places.csv');
    if(!res.ok) throw new Error('HTTP '+res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, {header:true, skipEmptyLines:true});
    if(parsed.errors && parsed.errors.length){
      console.warn('CSV 파싱 경고:', parsed.errors);
    }
    const EXPECTED_FIELDS = 15;
    PLACES = parsed.data
      .filter(row => Object.keys(row).length > 0 && row.name)
      .map(row => {
        if(Object.keys(row).length !== EXPECTED_FIELDS){
          console.warn(`행 필드 수 불일치(${Object.keys(row).length}/${EXPECTED_FIELDS}):`, row.name);
        }
        return {
          name: row.name,
          lat: row.lat ? parseFloat(row.lat) : null,
          lng: row.lng ? parseFloat(row.lng) : null,
          address: row.address,
          category: row.category,
          work: row.work,
          evidence: row.evidence,
          grade: row.evidence_grade ? parseInt(row.evidence_grade, 10) : null,
          sources: (row.source_url||'').split('|').map(s=>s.trim()).filter(Boolean),
          status: row.status,
          my_note: row.my_note,
          key_location: row.key_location,
          source_type: row.source_type,
          region: row.region || '',
          poi_type: row.poi_type || '',
        };
      });
    PLACES.forEach((p,i)=>p.__idx=i);
    init();
  } catch(e) {
    console.error('places.csv 로딩 실패:', e);
    errBox.textContent = 'places.csv를 불러오지 못했습니다: ' + e.message;
    errBox.style.display = 'block';
  }
}
```

- [ ] **Step 4: 에러 배너 DOM 추가**

`<div class="page">` 여는 태그 바로 다음 줄에 추가:

```html
<div id="loadError" style="display:none;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:10px 14px;margin:16px 0;font-size:13px;"></div>
```

- [ ] **Step 5: 파일 맨 끝 init 호출부 교체**

파일 끝의 다음 4줄:
```js
PLACES.forEach((p,i)=>p.__idx=i);
renderStats();
renderChips();
update();
```
를 다음으로 교체:

```js
function init(){
  renderStats();
  renderChips();
  update();
}
loadPlaces();
```

- [ ] **Step 6: 로컬 서버로 검증**

Run: `python -m http.server 8000` (haruki-map 폴더에서)
브라우저로 `http://localhost:8000/index.html` 접속.
Expected: 헤더 통계(전체 65, 좌표확보 등)와 카드 목록이 정상 렌더링됨. 개발자도구 콘솔에 에러 없음(SVG atlas 관련 에러는 Task 3에서 처리하므로 이 단계에서는 나도 됨 — 단, `loadPlaces`/`Papa`/`fetch` 관련 에러는 없어야 함).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: index.html 골격 — places.csv 런타임 로딩 + 카드 렌더링"
```

---

### Task 3: Leaflet 실지도 렌더링

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `PLACES`(Task 2), `CAT_META`(기존), `filtered()`(기존 — Task 4에서 필드 어댑트)
- Produces: 전역 `let leafletMap`, `let markerLayer`, `function renderMarkers(list)` (지도 위 마커를 list 기준으로 다시 그림), `function focusMarker(idx)` (해당 마커로 지도 이동+팝업 오픈)

- [ ] **Step 1: SVG atlas 마크업을 Leaflet 컨테이너로 교체**

기존:
```html
      <p class="map-caption">※ 실제 지리 좌표를 위경도 격자에 옮긴 개념도이며, 해안선은 그리지 않음(정밀 지도 아님)</p>
      <div class="map-svg-wrap">
        <svg id="atlas" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
```
교체:
```html
      <div class="map-svg-wrap">
        <div id="leafletMap"></div>
      </div>
```

- [ ] **Step 2: 지도 토글 버튼(일본/세계) 제거**

기존:
```html
        <div class="map-toggle">
          <button id="toggleJP" aria-pressed="true">일본</button>
          <button id="toggleWorld" aria-pressed="false">세계</button>
        </div>
```
교체 (빈 문자열 — Leaflet은 확대/축소로 두 범위를 다 커버하므로 토글 불필요):
```html
```

- [ ] **Step 3: 지도 컨테이너 CSS 추가**

`svg#atlas{width:100%;height:auto;display:block;}` 줄을 다음으로 교체:
```css
#leafletMap{width:100%;height:520px;display:block;background:var(--paper-raised);}
.leaflet-popup-content-wrapper{background:var(--paper-raised);color:var(--ink);border-radius:4px;}
.leaflet-popup-content{font-family:var(--font-body);font-size:13px;margin:10px 12px;}
.leaflet-popup-tip{background:var(--paper-raised);}
```

- [ ] **Step 4: BOUNDS/project/buildAtlas 함수를 Leaflet 렌더 함수로 교체**

`/* ---------- atlas (diagrammatic map) ---------- */` 주석부터 `buildAtlas` 함수 끝(`}`)까지 전체 블록(기존 `BOUNDS`, `VB`, `project`, `buildAtlas` — 원본 602~661번째 줄)을 다음으로 교체:

```js
/* ---------- leaflet map ---------- */
let leafletMap = null;
let markerLayer = null;
const markerRefs = new Map(); // __idx -> L.CircleMarker

function initMap(){
  leafletMap = L.map('leafletMap', {scrollWheelZoom:true}).setView([35.68, 139.75], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMap);
  markerLayer = L.layerGroup().addTo(leafletMap);
}

function renderMarkers(list){
  markerLayer.clearLayers();
  markerRefs.clear();
  list.filter(p=>p.lat!=null && p.lng!=null).forEach(p=>{
    const meta = CAT_META[p.category] || {color:'#9C9179'};
    const radius = p.key_location ? 9 : 6;
    const marker = L.circleMarker([p.lat, p.lng], {
      radius,
      color: p.__idx===state.selected ? 'var(--accent)' : meta.color,
      weight: p.__idx===state.selected ? 2.5 : 1.2,
      fillColor: meta.color,
      fillOpacity: 0.85,
    });
    marker.bindPopup(`<strong>${escHtml(p.name)}</strong><br>${escHtml(p.work||'')}`);
    marker.on('click', ()=>{
      const card = document.querySelector(`.card[data-id="${p.__idx}"]`);
      const isExpanding = !(card && card.classList.contains('expanded'));
      selectPlace(p.__idx, isExpanding, false);
    });
    marker.addTo(markerLayer);
    markerRefs.set(p.__idx, marker);
  });
}

function focusMarker(idx){
  const marker = markerRefs.get(idx);
  if(!marker) return;
  leafletMap.panTo(marker.getLatLng());
  marker.openPopup();
}
```

- [ ] **Step 5: legend의 ⭐ 텍스트 옆 A/B/C 범례는 그대로 두되, `map-head` 안의 "개념도 · Conceptual Atlas" 라벨을 실지도 표기로 변경**

기존:
```html
        <span class="eyebrow">개념도 · Conceptual Atlas</span>
```
교체:
```html
        <span class="eyebrow">지도 · OpenStreetMap</span>
```

- [ ] **Step 6: `selectPlace`가 `buildAtlas()`를 호출하던 부분을 마커 갱신으로 교체**

기존 `selectPlace` 함수 내부:
```js
function selectPlace(idx, expand, fromCard){
  state.selected = expand ? idx : null;
  buildAtlas();
```
교체:
```js
function selectPlace(idx, expand, fromCard){
  state.selected = expand ? idx : null;
  renderMarkers(filtered());
  if(expand) focusMarker(idx);
```

- [ ] **Step 7: 이제 존재하지 않는 toggleJP/toggleWorld 버튼의 리스너 제거**

Step 2에서 `#toggleJP`/`#toggleWorld` 버튼 자체를 HTML에서 삭제했으므로, 아래 리스너를 그대로 두면 `document.getElementById('toggleJP')`가 `null`을 반환해 `.addEventListener` 호출 시 `TypeError`가 발생하며 스크립트 전체가 중단된다. 다음 블록(원본 파일의 `/* ---------- init ---------- */` 주석 바로 앞, `selectPlace` 함수 뒤에 위치)을 찾아서 삭제한다:
```js
document.getElementById('toggleJP').addEventListener('click', ()=>{
  state.mapMode='jp';
  document.getElementById('toggleJP').setAttribute('aria-pressed','true');
  document.getElementById('toggleWorld').setAttribute('aria-pressed','false');
  buildAtlas();
});
document.getElementById('toggleWorld').addEventListener('click', ()=>{
  state.mapMode='world';
  document.getElementById('toggleJP').setAttribute('aria-pressed','false');
  document.getElementById('toggleWorld').setAttribute('aria-pressed','true');
  buildAtlas();
});
```
교체: (빈 문자열 — 완전히 삭제)

- [ ] **Step 8: `init()`에서 지도 초기화 + 최초 마커 렌더 호출**

Task 2에서 만든 `init()` 함수를 다음으로 교체:
```js
function init(){
  initMap();
  renderStats();
  renderChips();
  update();
}
```

그리고 `update()` 함수(현재 `function update(){ const list = filtered(); renderCards(list); buildAtlas(); }`)를 다음으로 교체:
```js
function update(){
  const list = filtered();
  renderCards(list);
  renderMarkers(list);
}
```

- [ ] **Step 9: 로컬 검증**

Run: `python -m http.server 8000` → `http://localhost:8000/index.html`
Expected: 일본 지도가 실제 OpenStreetMap 타일로 렌더링되고, 65건 중 좌표 있는 59건이 실제 위치(도쿄, 홋카이도, 그리스, 하와이 등)에 색깔 있는 원으로 표시됨. 마커 클릭 시 팝업이 뜨고 카드가 확장됨. 카드 클릭 시 지도가 해당 마커로 이동하고 팝업이 열림.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat: SVG 개념도를 Leaflet+OpenStreetMap 실지도로 교체"
```

---

### Task 4: 기존 필터(분류/출처유형/등급/핵심장소)를 CSV 기반 데이터에 맞게 재검증

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `PLACES`(Task 2, 필드명 `grade`/`sources`/`source_type` 등 이미 Task 2에서 기존 SVG 버전과 동일한 필드명으로 정규화됨)
- Produces: 변경 없음 (기존 `filtered()`, `renderChips()`, `CAT_META`, `TYPE_LABELS`가 이미 이 필드명 기준으로 작성되어 있어 로직 자체는 무수정)

- [ ] **Step 1: 필드명 일치 확인**

Task 2의 `loadPlaces()`가 만드는 객체 필드(`category`,`source_type`,`grade`,`key_location`,`work`,`evidence`,`address`)가 기존 `filtered()`/`cardHTML()`/`renderChips()`가 참조하는 필드명과 정확히 일치하는지 코드 대조. (이미 Task 2 Step 3에서 기존 SVG 버전과 동일한 필드명으로 맞춰뒀으므로 별도 코드 수정 없음 — 이 스텝은 검증 전용)

- [ ] **Step 2: 브라우저에서 각 필터 동작 확인**

`http://localhost:8000/index.html`에서:
- "분류" 칩(A/B/C) 하나 클릭 → 카드 수와 지도 마커 수가 같이 줄어드는지 확인
- "출처유형" 칩(소설/에세이·자전적/영화) 클릭 → 동일하게 필터링되는지 확인
- "근거등급" 칩(1/2/3) 클릭 → 필터링되는지 확인
- "⭐ 만 보기" 클릭 → key_location 있는 항목만 남는지 확인
- 검색창에 "1Q84" 입력 → work 필드에 1Q84 포함된 항목만 남는지 확인
- "필터 초기화" 클릭 → 전체 복원되는지 확인

Expected: 위 6가지 모두 카드 목록과 지도 마커가 함께 갱신됨(Task 3에서 `update()`가 `renderCards`+`renderMarkers`를 동시 호출하도록 이미 연결됨).

- [ ] **Step 3: Commit**

이 태스크는 코드 변경이 없으므로(검증 전용) 커밋 생략. 문제 발견 시에만 수정 후 커밋.

---

### Task 5: 지역(region) 필터 칩 추가

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `PLACES[].region`(Task 1/2), `state`(기존 전역 상태 객체)
- Produces: `state.regions`(Set, 기존 `state.cats`/`state.types`/`state.grades`와 동일 패턴)

- [ ] **Step 1: state에 regions 필드 추가**

기존:
```js
let state = {
  q:'',
  cats:new Set(),
  types:new Set(),
  grades:new Set(),
  starOnly:false,
  selected:null,
  mapMode:'jp'
};
```
교체:
```js
let state = {
  q:'',
  cats:new Set(),
  types:new Set(),
  grades:new Set(),
  regions:new Set(),
  excludedWorks:new Set(),
  starOnly:false,
  selected:null,
};
```
(`mapMode`는 Task 3에서 일본/세계 토글을 제거했으므로 함께 삭제)

- [ ] **Step 2: 지역 칩 그룹 HTML 추가**

`<div class="chip-group" id="starGroup">` 바로 앞에 추가:
```html
      <div class="chip-group" id="regionGroup">
        <span class="chip-group-label">지역</span>
      </div>
```

- [ ] **Step 3: renderChips에 지역 칩 렌더 추가**

기존 `renderChips` 함수 끝부분:
```js
  const gradeGroup = document.getElementById('gradeGroup');
  [1,2,3].forEach(g=>makeChip(gradeGroup,g,'등급'+g,state.grades,null));
}
```
교체:
```js
  const gradeGroup = document.getElementById('gradeGroup');
  [1,2,3].forEach(g=>makeChip(gradeGroup,g,'등급'+g,state.grades,null));
  const regionGroup = document.getElementById('regionGroup');
  const REGION_ORDER = ['간토','간사이','홋카이도','규슈','기타','해외'];
  const presentRegions = REGION_ORDER.filter(r=>PLACES.some(p=>p.region===r));
  presentRegions.forEach(r=>makeChip(regionGroup,r,r,state.regions,null));
}
```

- [ ] **Step 4: filtered()에 region 조건 추가**

기존:
```js
function filtered(){
  return PLACES.filter(p=>{
    if(state.cats.size && !state.cats.has(p.category)) return false;
    if(state.types.size && !state.types.has(p.source_type)) return false;
    if(state.grades.size && !state.grades.has(p.grade)) return false;
    if(state.starOnly && !p.key_location) return false;
```
교체:
```js
function filtered(){
  return PLACES.filter(p=>{
    if(state.cats.size && !state.cats.has(p.category)) return false;
    if(state.types.size && !state.types.has(p.source_type)) return false;
    if(state.grades.size && !state.grades.has(p.grade)) return false;
    if(state.regions.size && !state.regions.has(p.region)) return false;
    if(state.excludedWorks.has(p.work)) return false;
    if(state.starOnly && !p.key_location) return false;
```

- [ ] **Step 5: resetBtn 핸들러에 regions 초기화 추가**

기존:
```js
document.getElementById('resetBtn').addEventListener('click', ()=>{
  state.q=''; state.cats.clear(); state.types.clear(); state.grades.clear(); state.starOnly=false;
  document.getElementById('searchInput').value='';
  document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed','false'));
  update();
});
```
교체:
```js
document.getElementById('resetBtn').addEventListener('click', ()=>{
  state.q=''; state.cats.clear(); state.types.clear(); state.grades.clear();
  state.regions.clear(); state.starOnly=false;
  document.getElementById('searchInput').value='';
  document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed','false'));
  update();
});
```
(`state.excludedWorks`는 이 시점에 항상 빈 Set이라 `filtered()`의 `state.excludedWorks.has(p.work)` 체크는 안전하게 통과됨 — 작품 트리 UI 자체는 Task 6에서 추가되며, 그때 이 핸들러를 다시 한 번 수정해 `excludedWorks.clear()`와 `renderWorkTree()` 호출을 추가한다)

- [ ] **Step 6: 로컬 검증**

`http://localhost:8000/index.html`에서 "지역" 칩 그룹이 보이고, "홋카이도" 클릭 시 카드/마커가 홋카이도 지역 항목만 남는지 확인.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: 지역(region) 필터 칩 추가"
```

---

### Task 6: 작품별 필터 — 계층 트리 + 검색

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `PLACES[].work`, `PLACES[].source_type`, `state.excludedWorks`(Task 5)
- Produces: `function buildWorkTree(places)` (계층 구조 Map 반환), `function renderWorkTree()` (트리 UI 렌더, `state.workTreeQuery`로 검색 필터링)

- [ ] **Step 1: 작품 트리 패널 HTML 추가**

Task 5 Step 2까지 반영된 상태에서, `.chip-groups` 안의 마지막 요소인 다음 블록을 찾는다:
```html
      <button class="chip-reset" id="resetBtn">필터 초기화</button>
    </div>
  </div>
```
(첫 줄은 `resetBtn` 버튼, 둘째 줄은 `.chip-groups` 닫는 태그, 셋째 줄은 `.toolbar` 닫는 태그)

다음으로 교체 (`.chip-groups`의 형제 요소로 work-tree-panel을 끼워 넣고, `.toolbar` 닫는 태그는 그대로 유지):
```html
      <button class="chip-reset" id="resetBtn">필터 초기화</button>
    </div>
    <div class="work-tree-panel">
      <div class="work-tree-head">
        <span class="chip-group-label">작품</span>
        <input type="search" id="workTreeSearch" placeholder="작품명 검색…" autocomplete="off">
        <button class="chip-reset" id="workTreeToggleAll">전체 켜기/끄기</button>
      </div>
      <div id="workTree" class="work-tree"></div>
    </div>
  </div>
```

- [ ] **Step 2: CSS 추가**

`.chip-reset:hover{color:var(--accent);}` 다음 줄에 추가:
```css
.work-tree-panel{margin-top:4px;}
.work-tree-head{display:flex;gap:10px;align-items:center;margin-bottom:8px;}
.work-tree-head input[type="search"]{
  flex:1;min-width:0;background:var(--paper-raised);border:1px solid var(--rule);
  color:var(--ink);padding:6px 10px;font-size:13px;border-radius:3px;
}
.work-tree{max-height:180px;overflow-y:auto;border:1px solid var(--rule-soft);border-radius:4px;padding:8px 10px;background:var(--paper-raised);}
.wt-group{margin-bottom:6px;}
.wt-group-label{font-family:var(--font-mono);font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 3px;}
.wt-item{display:flex;align-items:center;gap:6px;font-size:12.5px;padding:2px 0 2px 12px;cursor:pointer;color:var(--ink-soft);}
.wt-item:hover{color:var(--ink);}
.wt-item input{cursor:pointer;}
.wt-item.hidden-by-search{display:none;}
```

- [ ] **Step 3: buildWorkTree / renderWorkTree 함수 작성**

`/* ---------- chips ---------- */` 주석 바로 앞에 추가:
```js
/* ---------- work tree ---------- */
function buildWorkTree(){
  const tree = {'장편소설':new Set(), '단편집':new Map(), '에세이·자전적':new Set(), '영화':new Set()};
  PLACES.forEach(p=>{
    if(p.source_type==='소설'){
      if(p.work.includes(' - ')){
        const [coll, piece] = p.work.split(' - ').map(s=>s.trim());
        if(!tree['단편집'].has(coll)) tree['단편집'].set(coll, new Set());
        tree['단편집'].get(coll).add(piece);
      } else {
        tree['장편소설'].add(p.work);
      }
    } else if(p.source_type==='에세이/자전적'){
      tree['에세이·자전적'].add(p.work);
    } else if(p.source_type==='영화'){
      tree['영화'].add(p.work);
    }
  });
  return tree;
}

function workItemHTML(workName){
  const checked = state.excludedWorks.has(workName) ? '' : 'checked';
  return `<label class="wt-item" data-work="${escAttr(workName)}"><input type="checkbox" ${checked}> ${escHtml(workName)}</label>`;
}

function renderWorkTree(){
  const tree = buildWorkTree();
  const root = document.getElementById('workTree');
  let html = '';
  html += `<div class="wt-group"><div class="wt-group-label">장편소설</div>`;
  html += [...tree['장편소설']].sort().map(workItemHTML).join('');
  html += `</div>`;
  html += `<div class="wt-group"><div class="wt-group-label">단편집</div>`;
  [...tree['단편집'].keys()].sort().forEach(coll=>{
    html += `<div style="padding-left:0;font-size:12px;color:var(--ink-soft);margin-top:4px;">${escHtml(coll)}</div>`;
    html += [...tree['단편집'].get(coll)].sort().map(piece=>workItemHTML(`${coll} - ${piece}`)).join('');
  });
  html += `</div>`;
  html += `<div class="wt-group"><div class="wt-group-label">에세이·자전적</div>`;
  html += [...tree['에세이·자전적']].sort().map(workItemHTML).join('');
  html += `</div>`;
  html += `<div class="wt-group"><div class="wt-group-label">영화</div>`;
  html += [...tree['영화']].sort().map(workItemHTML).join('');
  html += `</div>`;
  root.innerHTML = html;
  root.querySelectorAll('.wt-item input').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const workName = e.target.closest('.wt-item').dataset.work;
      if(e.target.checked) state.excludedWorks.delete(workName);
      else state.excludedWorks.add(workName);
      update();
    });
  });
  applyWorkTreeSearch();
}

function applyWorkTreeSearch(){
  const q = (state.workTreeQuery||'').toLowerCase();
  document.querySelectorAll('.wt-item').forEach(el=>{
    const match = !q || el.dataset.work.toLowerCase().includes(q);
    el.classList.toggle('hidden-by-search', !match);
  });
}

document.getElementById('workTreeSearch').addEventListener('input', e=>{
  state.workTreeQuery = e.target.value.trim();
  applyWorkTreeSearch();
});
document.getElementById('workTreeToggleAll').addEventListener('click', ()=>{
  const allExcluded = PLACES.every(p=>state.excludedWorks.has(p.work));
  if(allExcluded) state.excludedWorks.clear();
  else PLACES.forEach(p=>state.excludedWorks.add(p.work));
  renderWorkTree();
  update();
});
```

- [ ] **Step 4: resetBtn 핸들러에 작품 필터 초기화 추가**

Task 5에서 만든 resetBtn 핸들러:
```js
document.getElementById('resetBtn').addEventListener('click', ()=>{
  state.q=''; state.cats.clear(); state.types.clear(); state.grades.clear();
  state.regions.clear(); state.starOnly=false;
  document.getElementById('searchInput').value='';
  document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed','false'));
  update();
});
```
교체:
```js
document.getElementById('resetBtn').addEventListener('click', ()=>{
  state.q=''; state.cats.clear(); state.types.clear(); state.grades.clear();
  state.regions.clear(); state.excludedWorks.clear(); state.workTreeQuery=''; state.starOnly=false;
  document.getElementById('searchInput').value='';
  document.getElementById('workTreeSearch').value='';
  document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed','false'));
  renderWorkTree();
  update();
});
```

- [ ] **Step 5: init()에서 renderWorkTree 호출**

Task 3에서 만든 `init()`을 다음으로 교체:
```js
function init(){
  initMap();
  renderStats();
  renderChips();
  renderWorkTree();
  update();
}
```

- [ ] **Step 6: 로컬 검증**

`http://localhost:8000/index.html`에서:
- "작품" 패널에 장편소설/단편집/에세이·자전적/영화 그룹이 트리로 보임
- 특정 장편(예: "1Q84") 체크 해제 → 해당 작품 카드·마커가 사라짐
- 검색창에 "노르웨이" 입력 → 트리 목록이 "노르웨이의 숲" 관련 항목만 보이게 좁혀짐(체크 상태 자체는 안 바뀜, 찾기 편하게 목록만 필터링)
- "전체 켜기/끄기" 클릭 → 전체 작품이 한 번에 꺼졌다 켜졌다 함
- "필터 초기화" 클릭 → 작품 트리도 전체 체크 상태로 복원되는지 확인 (Task 5에서 만든 resetBtn 핸들러가 이번 Step 4에서 추가한 `renderWorkTree()` 호출까지 포함하는지 검증)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: 작품별 계층 트리 필터(검색 포함) 추가"
```

---

### Task 7: 식당·카페(poi_type) 마커 모양 구분

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `PLACES[].poi_type`(Task 1/2)
- Produces: 변경 없음(기존 `renderMarkers` 내부 로직만 확장)

- [ ] **Step 1: renderMarkers에서 poi_type에 따라 마커 모양 분기**

Task 3에서 작성한 `renderMarkers` 함수 내부:
```js
    const marker = L.circleMarker([p.lat, p.lng], {
      radius,
      color: p.__idx===state.selected ? 'var(--accent)' : meta.color,
      weight: p.__idx===state.selected ? 2.5 : 1.2,
      fillColor: meta.color,
      fillOpacity: 0.85,
    });
```
교체:
```js
    const isFood = p.poi_type === '식당카페';
    const marker = L.circleMarker([p.lat, p.lng], {
      radius,
      color: p.__idx===state.selected ? 'var(--accent)' : meta.color,
      weight: p.__idx===state.selected ? 2.5 : 1.2,
      fillColor: meta.color,
      fillOpacity: 0.85,
      ...(isFood ? {radius: radius+2, dashArray:'2,2'} : {}),
    });
```
(식당·카페류는 원 테두리를 점선으로, 반지름을 살짝 키워 시각적으로 구분 — Leaflet circleMarker는 아이콘 이미지 없이도 `dashArray`로 확실히 구분 가능하고 별도 이미지 에셋이 필요 없어 유지보수가 쉬움)

- [ ] **Step 2: 범례에 표시 추가**

기존:
```html
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:var(--indigo)"></span>A 실존_작가</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--moss)"></span>B 실존_작중언급</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--brass)"></span>C 모티브추정</span>
        <span class="legend-item">⭐ 핵심장소</span>
      </div>
```
교체:
```html
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:var(--indigo)"></span>A 실존_작가</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--moss)"></span>B 실존_작중언급</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--brass)"></span>C 모티브추정</span>
        <span class="legend-item">⭐ 핵심장소</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--ink-faint);border:1px dashed var(--ink)"></span>점선 = 지금도 방문 가능한 식당·카페</span>
      </div>
```

- [ ] **Step 3: 로컬 검증**

`http://localhost:8000/index.html`에서 토아로드 델리카테센·cafe 螢明舎·피노키오·아 쿠카냐·FiGARO 마커가 다른 마커보다 살짝 크고 테두리가 점선인지 확인 (지도를 해당 위치로 확대해서 확인).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 방문 가능한 식당/카페 마커 시각적 구분(poi_type)"
```

---

### Task 8: 배포 — GitHub Pages 반영 확인

**Files:**
- Modify: 없음 (배포 검증 전용)

**Interfaces:** 없음

- [ ] **Step 1: 최종 로컬 스모크 테스트**

`http://localhost:8000/index.html`에서 전체 기능 재확인:
- 통계 행 숫자가 실제 CSV 행 수(65)와 일치
- 필터 6종(분류/출처유형/등급/지역/작품트리/⭐) 모두 정상 작동
- 좌표 없는 6건(시나가와구 등)이 카드에는 보이되 지도에는 안 그려짐
- `places.csv` 파일명을 임시로 바꿔서(`mv places.csv places.csv.bak`) 새로고침 → 에러 배너가 보이는지 확인 후 원상복구(`mv places.csv.bak places.csv`)

- [ ] **Step 2: 원격에 푸시**

```bash
git push origin main
```

- [ ] **Step 3: GitHub Pages 빌드 확인**

Run: `gh api repos/kzxoxc/haruki-map/pages/builds/latest`
Expected: `"status": "built"` (빌드 중이면 `"building"` — 30초 정도 후 재확인)

- [ ] **Step 4: 배포 URL 최종 확인**

`https://kzxoxc.github.io/haruki-map/` 브라우저 접속.
Expected: 로컬에서 확인한 것과 동일하게 지도·카드·필터가 정상 작동. (배포 환경은 실제 웹 서버라 CORS 문제 없이 `places.csv`가 fetch됨 — 로컬 `file://`로 직접 열면 이 fetch가 실패하므로 반드시 `http://` 경유로만 테스트했음을 재확인)

- [ ] **Step 5: report.md에 배포 완료 기록**

`report.md` "다음 단계" 섹션 아래에 추가:
```markdown
## 실지도 사이트 배포 (2026-07-28)

Leaflet+OpenStreetMap 기반 실제 지도 사이트를 완성해 GitHub Pages에 배포:
https://kzxoxc.github.io/haruki-map/
저장소: https://github.com/kzxoxc/haruki-map (public)
places.csv에 region(지역)/poi_type(식당·카페 여부) 컬럼 추가, 작품별 계층 트리 필터·지역 필터 신설.
```

```bash
git add report.md
git commit -m "docs: 실지도 사이트 배포 완료 기록"
git push origin main
```

---

## Self-Review Notes

- **스펙 커버리지:** 데이터 스키마 변경(Task 1) / 아키텍처(Task 2,3) / 필터 UI(Task 4,5,6) / 마커 스타일(Task 7) / 배포(Task 8) / 에러 처리(Task 2 Step 3~4, Task 8 Step 1) 모두 스펙 섹션과 1:1 대응 확인.
- **필드명 일관성:** `loadPlaces()`(Task 2)가 만드는 필드명(`grade`,`sources`,`region`,`poi_type` 등)이 `filtered()`(Task 5), `cardHTML()`(기존), `renderMarkers()`(Task 3,7)에서 참조하는 이름과 모두 일치하도록 맞춤.
- **상태 필드 일관성:** `state.mapMode`는 Task 3에서 토글 제거와 함께 삭제, `state.regions`(Task 5)·`state.excludedWorks`(Task 5,6)·`state.workTreeQuery`(Task 6)를 새로 추가 — 모든 참조 지점에서 동일한 이름 사용 확인.
