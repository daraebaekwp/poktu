// =====================================================================
//  폭투 영남알프스 — 직접 플레이하는 격투 게임 (전시용)
//  index.html(영상용 대본 게임)의 그림·연출 코드를 가져와 실시간 조작으로 바꾼 것
//  구성: 불러오기 → 타이틀 → 모드 선택 → 배경음악 고르기 → 캐릭터 선택 → (2인: 경기장 선택) → VS → 대전 → 결과/컨티뉴/엔딩
// =====================================================================
(function () {
'use strict';
const W = 1920, H = 1080, GROUND = 1010, DT = 1 / 60, SC = window.PLAY_SCALE || .46;
const WALL_L = 110, WALL_R = W - 110;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const FONT = '"Jua", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const NUM = '"Oswald", "Jua", sans-serif';
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');
const MANUAL = Q.has('manual');
const BETA = /beta\.html$/.test(location.pathname) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // 10/2 시험판: 기록·공유 순위 안 남김   // 점검용: 화면은 그리되 게임은 GAME.steps() 로만 진행
const CHARS = window.CHARACTERS, ROSTER = window.ROSTER, STAGES = window.STAGES, BOSS = window.BOSS_KEY;

// ---------- 박람회 설정 (타이틀에서 펀치+킥+필살 3초 = 설정 화면 · 주소 뒤 ?rounds=2&timer=45&cpu=-1&idle=60 도 됨) ----------
//  저장: localStorage 'pokto_settings_v1'. 우선순위 = 주소(URL) 값 > 설정 화면에서 저장한 값 > 기본값
const SETTINGS_KEY = 'pokto_settings_v1';
const SET_OPTS = { rounds: [3, 2, 1], timer: [60, 45, 30], cpu: [-1, 0, 1], idle: [15, 30, 45, 60, 90, 120], comic: [1, 0] };
const SET_DEF = { rounds: 3, timer: 60, cpu: 0, idle: 30, comic: 1 };   // comic = 스토리 모드 만화 컷씬 (1 켜기 · 0 끄기, 주소 ?comic=0)
const SET = Object.assign({}, SET_DEF);
const SET_URL = {};
function settingsLoad() {
  let sv = {}; try { sv = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) {}
  for (const k in SET_DEF) { const v = +sv[k]; SET[k] = SET_OPTS[k].includes(v) ? v : SET_DEF[k]; }
  for (const k in SET_DEF) if (Q.has(k)) { const v = +Q.get(k); if (k === 'idle' ? v >= 5 && v <= 3600 : SET_OPTS[k].includes(v)) { SET[k] = v; SET_URL[k] = true; } }
}
function settingsSave() { try { const o = {}; for (const k in SET_DEF) o[k] = SET[k]; localStorage.setItem(SETTINGS_KEY, JSON.stringify(o)); } catch (e) {} }
settingsLoad();
const idleMs = () => SET.idle * 1000;                                  // 아무도 안 만지면 데모까지
const ARCADE_SEQ = { 3: [0, 1, 2], 2: [0, 2], 1: [0] };                // 판 수 → 경기장 순서 (2판 = 신불산 + 가지산, 1판 = 신불산)
const arcadeSeq = () => ARCADE_SEQ[SET.rounds] || ARCADE_SEQ[3];
const aiFor = st => clamp(STAGES[st].ai + SET.cpu, 1, 3);              // 경기장 기본 난이도 + CPU 난이도 보정
const isFinalStage = st => { const s = arcadeSeq(); return st === s[s.length - 1]; };
const nextStage = st => { const s = arcadeSeq(), i = s.indexOf(st); return i >= 0 && i < s.length - 1 ? s[i + 1] : null; };

const A = window.Audio2, IN = window.Input;

// ---------- 공통 상태 ----------
let T = 0;                       // 시뮬레이션 시간(초) — 효과·트윈 기준 (슬로모션 때 천천히 흐름)
let RT = 0;                      // 실제 시간(초) — 슬로모션과 상관없이 흐름 (카메라 연출·도장 글자)
let scene = { name: 'boot', t: 0 };
let fx = [], tweens = [], queue = [];
let cam, overlay, ex, hud, combo, slow, cine;
let G = null;                    // 현재 대전
const IMG = {}, SPR = {}, BG = [], READY = {};
let loadDone = 0, loadTotal = 1, errCount = 0;
let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rr = (a, b) => a + (b - a) * Math.random();
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function resetFx() {
  fx = []; tweens = []; queue = [];
  cam = { zoom: 1, x: W / 2, y: H / 2, shake: 0, rot: 0 };
  slow = { k: 1, to: 1, left: 0 };                 // 슬로모션: k = 게임 속도(1 = 보통, .15 = 아주 느리게)
  cine = { desat: 0, bars: 0 };                    // 연출: 배경 흑백 정도 · 위아래 검은 띠
  overlay = { dark: 0, white: 0, speed: 0, speedX: 0, speedCol: '#ffe9a0' };
  ex = { burst: 0, burstCol: ['#ffb000', '#ff4d00'], sun: 0, siren: 0 };
  hud = { show: 0 };
  combo = { side: 0, n: 0, last: -9, shown: 0, pop: 0 };
}
resetFx();

// ---------- 트윈 · 예약 ----------
const EASE = {
  lin: t => t, out: t => 1 - Math.pow(1 - t, 3), in: t => t * t * t,
  io: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  back: t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
// real = true 이면 슬로모션과 상관없이 실제 시간으로 (카메라 연출용)
function tw(o, to, dur, ease = 'out', real = false) { tweens = tweens.filter(tn => !(tn.o === o && Object.keys(to).some(k => k in tn.to))); const from = {}; for (const k in to) from[k] = o[k] || 0; tweens.push({ o, from, to, t0: real ? RT : T, dur: Math.max(1e-3, dur), ease: EASE[ease], real }); }
function stepTweens() { tweens = tweens.filter(tn => { const p = Math.min(1, ((tn.real ? RT : T) - tn.t0) / tn.dur), e = tn.ease(p); for (const k in tn.to) tn.o[k] = tn.from[k] + (tn.to[k] - tn.from[k]) * e; return p < 1; }); }
function later(dt, fn) { queue.push({ t: T + dt, fn }); }
function rlater(dt, fn) { queue.push({ t: RT + dt, fn, real: true }); }   // 실제 시간 예약
function runQueue() { if (!queue.length) return; const now = e => e.real ? RT : T; const due = queue.filter(e => now(e) >= e.t); if (!due.length) return; queue = queue.filter(e => now(e) < e.t); for (const e of due) e.fn(); }
const fxAge = f => (f.rt ? RT : T) - f.t0;
const fxAlive = f => fxAge(f) < f.life;

// =====================================================================
//  불러오기
// =====================================================================
function load(src, tries = 3) { return new Promise(r => { const i = new Image(); i.onload = () => { loadDone++; r(i); }; i.onerror = () => { if (tries > 1) setTimeout(() => load(src, tries - 1).then(r), 700); else { loadDone++; r(null); } }; i.src = src; }); }   // 웹 링크판: 세 번까지 다시 받음
function charPoseList(C) {
  const s = new Set(Object.values(C.poses));
  for (const m of Object.values(C.moves)) { if (m.pose) s.add(m.pose); if (m.anim) m.anim.forEach(a => s.add(a[0])); }
  for (const sp of C.specials) { if (sp.windupPose) s.add(sp.windupPose); if (sp.pose) s.add(sp.pose); for (const a of [...(sp.pre || []), ...(sp.anim || [])]) s.add(a[0]); if (sp.vfx && sp.vfx.aimPose) s.add(sp.vfx.aimPose); }
  return [...s];
}
function autoAnchor(img) { // 발바닥 = 가장 아래 불투명 줄, 가운데 = 발 부근 불투명 픽셀 평균 (로컬 서버에서만 가능)
  try {
    const f = 4, w = Math.ceil(img.width / f), h = Math.ceil(img.height / f), c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
    let bot = -1, top = h; for (let y = h - 1; y >= 0 && bot < 0; y--) for (let xx = 0; xx < w; xx++) if (d[(y * w + xx) * 4 + 3] > 60) { bot = y; break; }
    for (let y = 0; y < h && top === h; y++) for (let xx = 0; xx < w; xx++) if (d[(y * w + xx) * 4 + 3] > 60) { top = y; break; }
    if (bot < 0) return null;
    // 몸 중심 x = 불투명 픽셀들의 가로 중앙값 (뻗은 팔·다리에 덜 흔들림)
    const col = new Array(w).fill(0); let n = 0;
    for (let y = top; y <= bot; y++) for (let xx = 0; xx < w; xx++) if (d[(y * w + xx) * 4 + 3] > 60) { col[xx]++; n++; }
    let acc = 0, mx = 0; for (let xx = 0; xx < w; xx++) { acc += col[xx]; if (acc >= n / 2) { mx = xx; break; } }
    return { ax: Math.round(mx * f), ay: Math.round(bot * f), top: top * f, bot: bot * f };
  } catch (e) { return null; }
}
function bakeSprite(key, pose, img, C) { // 크기에 맞춰 미리 줄이고 색 보정까지 구워 둠 → 매 프레임 필터 비용 없음
  const m = Object.assign({}, C.META[pose] || {});
  let a = null;
  if (m.ax == null || m.ay == null || m.h) a = autoAnchor(img);
  if (m.ax == null || m.ay == null) { const d = a || { ax: img.width / 2, ay: img.height * .98 }; if (m.ax == null) m.ax = d.ax; if (m.ay == null) m.ay = d.ay; m.auto = true; }
  // h = 화면에서 보일 몸 높이(px). 여백 없이 잘라 낸 그림처럼 장마다 배율이 다를 때 씀 → k 자동 계산
  if (m.h) { const bb = a ? Math.max(1, a.bot - a.top) : img.height * .96; m.k = m.h / (bb * SC * (C.size || 1)); }
  const s = SC * (m.k || 1) * (C.size || 1), w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.filter = 'saturate(1.25) contrast(1.06)'; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
  featherCut(x, w, h);
  SPR[key + '/' + pose] = { cv: c, w, h, ax: m.ax * s, ay: m.ay * s, flip: !!m.flip, auto: !!m.auto, head: headSpot(x, w, h, m.ax * s, m.ay * s), meta: { k: +(m.k || 1).toFixed(4), ax: Math.round(m.ax), ay: Math.round(m.ay) } };
}
function headSpot(x, w, h, ax, ay) {   // 머리 위치(발 기준): 맨 위 불투명 줄 아래 머리 띠의 가운데 → 필살기 연출(볼 빵빵 등)에 씀
  try { const d = x.getImageData(0, 0, w, h).data; let top = -1; for (let y = 0; y < h && top < 0; y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 80) { top = y; break; }
    if (top < 0) return null; const band = Math.round(h * .12); let sx = 0, n = 0;
    for (let y = top; y < Math.min(h, top + band); y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 80) { sx += i; n++; }
    return { x: (n ? sx / n : w / 2) - ax, y: top - ay, size: band };
  } catch (e) { return null; }
}
function featherCut(x, w, h) { // 그림이 캔버스 좌우 끝에 닿아 잘려 있으면 그 끝을 부드럽게 흐려서 "칼로 자른 선"이 안 보이게
  try {
    const col = cx => { const d = x.getImageData(cx, 0, 1, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; return n; };
    const fw = Math.max(10, Math.round(w * .07));
    for (const [edge, cx] of [['L', 0], ['R', w - 1]]) { if (col(cx) < 4) continue;
      x.save(); x.filter = 'none'; x.globalCompositeOperation = 'destination-out';
      const g = edge === 'R' ? x.createLinearGradient(w, 0, w - fw, 0) : x.createLinearGradient(0, 0, fw, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(edge === 'R' ? w - fw : 0, 0, fw, h); x.restore(); }
  } catch (e) {}
}
function bakeBg(img) {
  const c = document.createElement('canvas'); c.width = W + 80; c.height = H + 80; const x = c.getContext('2d');
  if (img) { x.filter = 'saturate(1.35) contrast(1.08)'; x.drawImage(img, 0, 0, W + 80, H + 80); } else { x.fillStyle = '#6a8a5a'; x.fillRect(0, 0, W + 80, H + 80); }
  return c;
}
// 임시: 가장자리가 잘린 그림 대신 쓸 자세 (sprites/fixed_meta_0929.json 이 생기면 = 고친 그림이 오면 자동으로 원래대로)
const INTERIM_SWAP = {};   // 2026-09-29 잘린 그림 수정 완료 → 임시 대체(hit→g_head, lose→g_shrug) 끔
async function loadAll() {
  const jobs = [];
  let fixedArrived = false; try { const r = await fetch('sprites/fixed_meta_0929.json', { cache: 'no-store' }); fixedArrived = r.ok; } catch (e) {}
  if (!fixedArrived) for (const [k, sw] of Object.entries(INTERIM_SWAP)) { const C = CHARS[k]; if (C) Object.assign(C.poses, sw); }
  for (const C of Object.values(CHARS)) for (const c of C.commands || []) if (C.moves[c.move]) C.moves[c.move].cmd = c;   // 기술 표시
  const voiceSet = ['a_round1', 'a_round2', 'a_final', 'a_fight', 'a_ko', 'a_win', 'a_perfect', 's_lose', 's_age', 's_sun', 'g_sun', 'g_up', 's_haha', 'g_chodding'];
  for (const [key, C] of Object.entries(CHARS)) {
    const poses = charPoseList(C);
    for (const sp of C.specials) voiceSet.push(sp.voice, sp.vfx && sp.vfx.voice);
    for (const v of Object.values(C.voices || {})) Array.isArray(v) ? voiceSet.push(...v) : voiceSet.push(v);
    for (const l of C.introLines || []) if (l) voiceSet.push(l.voice);
    if (C.endingAnswer) voiceSet.push(C.endingAnswer.voice);
    voiceSet.push(...(C.extraVoices || []));
    for (const m of Object.values(C.moves)) voiceSet.push(m.voice);
    jobs.push((async () => {
      const first = await load(`sprites/${C.poses.idle}.webp`);
      if (!first) { READY[key] = false; console.info(`[캐릭터 ${key}] sprites/${C.poses.idle}.png 이 없어 "준비중" 처리`); return; }
      const imgs = await Promise.all(poses.map(p => p === C.poses.idle ? first : load(`sprites/${p}.webp`)));
      const missing = poses.filter((p, i) => !imgs[i]);
      READY[key] = missing.length === 0;
      if (missing.length) console.info(`[캐릭터 ${key}] 그림이 없어 "준비중" 처리: ${missing.join(', ')}`);
      else poses.forEach((p, i) => bakeSprite(key, p, imgs[i], C));
      if (!READY[key]) return;
      const extra = [C.face, C.vs, C.fight, C.fightCut, ...C.specials.map(s => s.cutin)].filter(Boolean);
      await Promise.all(extra.map(async src => { IMG[src] = await load(src); }));
      for (const sp of C.specials) { const n = sp.vfx && sp.vfx.img; if (n && !['cloud', 'sound', 'glasses', 'bullet'].includes(n) && !(('vfx_' + n) in IMG)) { IMG['vfx_' + n] = null; IMG['vfx_' + n] = await load(`vfx/${n}.webp`); } }
      for (const sp of C.specials) for (const sh of (sp.vfx && Array.isArray(sp.vfx.shots) ? sp.vfx.shots : [])) if (sh.img && !(('vfx_' + sh.img) in IMG)) { IMG['vfx_' + sh.img] = null; IMG['vfx_' + sh.img] = await load(`vfx/${sh.img}.webp`); }   // 발마다 다른 그림(직장인)
    })());
  }
  for (const r of ROSTER) jobs.push(load(r.face).then(i => IMG[r.face] = i));
  for (const v of ['whale', 'buoy', 'fire', 'boom']) jobs.push(load(`vfx/${v}.webp`).then(i => IMG['vfx_' + v] = i));
  STAGES.forEach((s, i) => jobs.push(load(s.bg).then(img => { BG[i] = bakeBg(img); IMG['thumb' + i] = img; })));
  loadTotal = 120;
  A.setVoices(voiceSet);
  await Promise.all(jobs);
  const ALLTXT = '!?,.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz가나다라마바사아자차카타파하';
  for (const f of ['100px "Jua"', '700 100px "Oswald"', '500 100px "Oswald"']) { try { await document.fonts.load(f, ALLTXT); } catch (e) {} }
  try { await document.fonts.ready; } catch (e) {}
  window.fontsOK = document.fonts.check('100px "Jua"') && document.fonts.check('700 100px "Oswald"');
}

// =====================================================================
//  효과 (index.html 에서 가져옴 · 불꽃은 동그란 충격파와 둥근 입자로만 — 방사형 광선 없음)
// =====================================================================
function spark(x, y, big = 1, col = '#fff6c0') {
  fx.push({ type: 'ring', x, y, t0: T, life: .28 * big, r: 170 * big, col, lw: 22 });
  fx.push({ type: 'ring', x, y, t0: T + .05, life: .3 * big, r: 110 * big, col: '#ffffff', lw: 10 });
  fx.push({ type: 'flash', x, y, t0: T, life: .12, r: 70 * big });
  for (let i = 0; i < 9 * big; i++) { const a = rnd() * Math.PI * 2, v = (250 + rnd() * 500) * big;
    fx.push({ type: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, t0: T, life: .3 + rnd() * .25, r: 7 + rnd() * 9 * big, col }); }
}
function dust(x, dir, n = 8, y = GROUND - 10) { for (let i = 0; i < n; i++) fx.push({ type: 'dust', x: x + (rnd() - .5) * 60, y, vx: -dir * (80 + rnd() * 200), vy: -40 - rnd() * 120, t0: T, life: .5 + rnd() * .3, r: 16 + rnd() * 20 }); }
function text(str, opt = {}) {
  fx.push({ type: 'text', str, t0: T, life: opt.life || 1.4, x: opt.x ?? W / 2, y: opt.y ?? H / 2, size: opt.size || 150,
    col: opt.col || '#ffd23f', stroke: opt.stroke || '#3a1400', rot: opt.rot || 0, panel: opt.panel, font: opt.font });
  A.sfx('blip');
}
function renderText(f) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), FF = f.font || FONT, LS = /^(ROUND|FINAL)/.test(f.str) ? Math.round(f.size * .06) + 'px' : '0px'; x.font = `700 ${f.size}px ${FF}`; x.letterSpacing = LS;
  const w = Math.ceil(x.measureText(f.str).width + f.size * 1.2), h = Math.ceil(f.size * 2); c.width = w; c.height = h;
  x.font = `700 ${f.size}px ${FF}`; x.letterSpacing = LS; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.translate(w / 2, h / 2);
  x.lineWidth = f.size * .08; x.strokeStyle = '#000'; x.strokeText(f.str, 0, 0);
  x.lineWidth = f.size * .04; x.strokeStyle = f.stroke; x.strokeText(f.str, 0, 0);
  x.fillStyle = f.col; x.fillText(f.str, 0, 0); return c;
}
function pop(str, x, y, col = '#fff', size = 64) { fx.push({ type: 'pop', str, x, y, col, size, t0: T, life: .9 }); }
// "여긴 내 산인데?" 말풍선 둘레로 둥근 불똥이 톡톡 튐 (만화 영축산 눈 칸과 같은 모양, 광선 없음)
function emberPops(t, w, h) {
  let s = 7; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  for (let i = 0; i < 24; i++) {
    const delay = R() * 1.1, life = .7 + R() * .5, side = R() < .5 ? -1 : 1, x0 = side * R() * (w / 2 - 30), y0 = -h * .5;
    const vx = side * (160 + R() * 460), vy = -520 - R() * 560, r = 7 + R() * 12;
    const u = t - delay; if (u < 0) continue; const k = (u % (life + .25)); if (k > life) continue;
    const px = x0 + vx * k, py = y0 + vy * k + 1100 * k * k;
    ctx.globalAlpha = Math.max(0, 1 - k / life) * ctx.globalAlpha0; ctx.fillStyle = i % 3 === 0 ? '#ff5a1f' : i % 3 === 1 ? '#ffb02e' : '#ffd23f';
    ctx.beginPath(); ctx.arc(px, py, r * (1 - .5 * k / life), 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function say(who, str, life = 1.6) { fx = fx.filter(f => !(f.type === 'bubble' && f.who === who)); fx.push({ type: 'bubble', who, str, t0: T, life }); }
function ghost(o) { fx.push({ type: 'ghost', who: o, pose: o.pose, x: o.x + o.ox, y: o.y, rot: o.rot, dir: o.dir, sx: o.sx, sy: o.sy, t0: T, life: .2 }); }
function facePt(o) {   // 얼굴 가운데(대략): 그림에서 찾은 머리 꼭대기 + 머리 크기
  const spr = SPR[o.key + '/' + o.pose], hd = spr && spr.head; if (!hd) return { x: o.x, y: headY(o) + 90 };
  const fl = o.dir * o.C.facing * (spr.flip ? -1 : 1); return { x: o.x + hd.x * fl, y: o.y + hd.y + hd.size * 1.1 };
}
function headY(o) { return o.y - (['lose', 'down', 'dead'].includes(o.state) ? o.C.body.crouchH * .95 : o.C.headH); }
function superHit(x, y, col) {
  fx.push({ type: 'boom', x, y, t0: T, life: .8 });
  for (let i = 0; i < 4; i++) fx.push({ type: 'ring', x, y, t0: T + i * .07, life: .5 + i * .1, r: 320 + i * 160, col: i % 2 ? '#fff' : col, lw: 22 });
  for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, v = 400 + rnd() * 900; fx.push({ type: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 250, t0: T, life: .4 + rnd() * .5, r: 10 + rnd() * 14, col: rnd() > .5 ? '#fff' : col }); }
  overlay.white = .9; tw(overlay, { white: 0 }, .5, 'lin');
  // 10/2 번쩍번쩍: 흰 빛 두 번 더 깜빡 + 반짝이 + 동그란 충격파 한 겹 더 (방사형 광선 없음)
  [.1, .22].forEach((d, i) => later(d, () => { overlay.white = .75 - i * .2; tw(overlay, { white: 0 }, .16, 'lin', true); }));
  for (let i = 0; i < 30; i++) { const a = rnd() * Math.PI * 2, v = 250 + rnd() * 1300; fx.push({ type: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 300, t0: T + rnd() * .15, life: .5 + rnd() * .6, r: 6 + rnd() * 10, col: ['#fff', '#ffe600', col][i % 3] }); }
  later(.12, () => shockwave(x, y, 1.4, col));
}
function knockout(target) { // 멈칫 → 보색 번짐 → 확대 튕김 → K.O. 쾅
  ex.burstCol = ['#ffe600', '#7b2cff']; ex.burst = 1; G.hitstop = 27;
  cam.zoom = 1.4; cam.x = clamp(target.x, 700, W - 700); cam.y = GROUND - 460; tw(cam, { zoom: 1, x: W / 2, y: H / 2 }, .55, 'out'); cam.shake = 40;
  later(.05, () => { text('K.O.', { size: 470, life: 2.4, col: '#ff2030', stroke: '#ffe600', rot: -.05, font: NUM }); A.voice('a_ko'); cam.shake = 34; });
  later(1.9, () => tw(ex, { burst: 0 }, .6));
}
function cutin(img, side, name, col, col2, life = 1.2, sub = '필살기') { fx.push({ type: 'cutin', img, side, name, col, col2, t0: RT, rt: true, life, sub }); A.sfx('cutin'); }

// =====================================================================
//  파이터
// =====================================================================
function newFighter(key, side, x) {
  const C = CHARS[key];
  return { key, C, side, x, y: GROUND, vx: 0, vy: 0, dir: side === 0 ? 1 : -1, hp: 100, hpLag: 100, meter: 0,
    state: 'idle', st: 0, move: null, moveKey: '', moveHit: false, buf: null, hist: [], chainN: 0, moveHits: 0, jumpHitT: -9, fromJump: false, bannered: false, air: false, airAtk: -1, airHit: false,
    pose: C.poses.idle, ox: 0, sx: 1, sy: 1, rot: 0, tint: 0, glow: 0, dizzy: 0, invul: 0, stun: 0, hurtVoiceCd: 0,
    in: IN.p[side], ai: null, dmgIn: C.def || 1, dmgOut: 1, sp: null, holdBack: false, crouching: false, guardPose: false, hue: 0, label: '' };
}
const P = f => f.C.poses;
function setState(f, s, pose) { f.state = s; f.st = 0; if (pose) f.pose = pose; }
function opp(f) { return G.f[1 - f.side]; }
function grounded(f) { return f.y >= GROUND && f.vy >= 0; }
function faceOpp(f) { const o = opp(f); if (Math.abs(o.x - f.x) > 4) f.dir = o.x > f.x ? 1 : -1; }

// ---------- 기술 입력 (커맨드 + 쉬운 입력) ----------
const MOTIONS = { '236': [[2], [3, 6], [6]], '214': [[2], [1, 4], [4]], '623': [[6], [2, 3], [3]] };
const EASY = { f: 6, b: 4, df: 3 };
const CMD_WIN = 20;                              // 커맨드는 20프레임(1/3초) 안에만 대충 맞으면 인정
function motionOk(f, mo) { const seq = MOTIONS[mo]; if (!seq) return false; const h = f.hist.slice(-CMD_WIN); let i = 0; for (const e of h) { if (seq[i].includes(e.d)) i++; if (i >= seq.length) return true; } return false; }
function cmdFor(f, btn) {
  const cs = f.C.commands; if (!cs || !cs.length) return null; const d = f.hist.length ? f.hist[f.hist.length - 1].d : 5;
  for (const mo of ['623', '236', '214']) for (const c of cs) if (c.btn === btn && c.motion === mo && motionOk(f, mo)) return c;
  for (const c of cs) if (c.btn === btn && EASY[c.easy] === d) return c;
  return null;
}
function pressCount(f, b, n) { let k = 0; for (const e of f.hist.slice(-n)) if (e[b]) k++; return k; }
function tryAttack(f, inp) { // 서 있거나 걷거나 앉아 있을 때 버튼 → 기술 · 연타 · 기본기
  const pr = inp.pressed, b = pr.p ? 'p' : pr.k ? 'k' : null; if (!b) return false;
  const c = cmdFor(f, b); if (c) { startMove(f, c.move, b); return true; }
  if (b === 'p' && f.C.rapid && pressCount(f, 'p', 24) >= 3) { startMove(f, f.C.rapid.move, 'p'); return true; }
  startMove(f, b === 'p' ? (inp.d ? 'crouchPunch' : 'punch') : (inp.d ? 'crouchKick' : 'kick'), b); return true;
}
function banner(f, str) { fx = fx.filter(e => !(e.type === 'banner' && e.side === f.side)); fx.push({ type: 'banner', str, side: f.side, t0: T, life: 1.4 }); A.sfx('sparkle'); }
function startMove(f, key, btn, chained) {
  let m = f.C.moves[key]; if (!m) return;
  if (m.proj && G.proj.some(p => p.owner === f && p.light)) { key = 'punch'; m = f.C.moves.punch; }   // 작은 발사체는 한 번에 하나
  f.chainN = chained ? f.chainN + 1 : 0; f.moveHits = 0; f.bannered = false; f.fromJump = T - f.jumpHitT < .8;
  f.move = m; f.moveKey = key; f.moveBtn = btn; f.moveHit = false; f.buf = null; f.vx = 0;
  if (m.invul) f.invul = m.invul;
  setState(f, 'attack', m.pose || (m.anim && m.anim[0][0]));
  f.sx = .94; tw(f, { sx: 1 }, m.startup / 60 + .02);
  if (m.voice && Math.random() < .55) A.voice(m.voice, .9); else A.sfx('whoosh');
}
function startSpecial(f) {
  const sp = f.C.specials[G.stage] || f.C.specials[0]; if (!sp) return;
  const o = opp(f);
  f.meter = 0; f.vx = 0; setState(f, 'special', sp.windupPose || P(f).idle); f.sp = { def: sp, t: 0, fired: false, shots: 0 };
  const cf = sp.cutinF || 72;                                       // 컷인 길이(프레임)
  f.invul = 999; G.freeze = cf + (sp.hold || 0); G.freezeBy = f;   // hold = 컷인이 끝난 뒤에도 멈춘 채로 보여 줄 준비 동작(경례·안경 벗기)
  tw(f, { glow: 1 }, .5); overlay.speedX = f.dir < 0 ? 1 : 0; overlay.speedCol = sp.col; tw(overlay, { dark: .62, speed: 1 }, .25);
  tw(cam, { zoom: 1.22, x: clamp(f.x + f.dir * 120, 790, W - 790), y: GROUND - 430 }, .35, 'io');
  ex.burstCol = sp.burstCol || [sp.col, sp.col2]; tw(ex, { burst: .75 }, .25);
  cutin(IMG[sp.cutin] ? sp.cutin : f.C.face, f.x <= o.x ? 'L' : 'R', /[!?]$/.test(sp.name) ? sp.name : sp.name + '!', sp.col, sp.col2, cf / 60);
  overlay.white = .7; tw(overlay, { white: 0 }, .3, 'lin', true); rlater(.12, () => { overlay.white = .45; tw(overlay, { white: 0 }, .2, 'lin', true); });   // 10/2 필살기 시작 번쩍번쩍
  const cn = CINE[sp.cine]; if (cn && cn.start) cn.start(f, f.sp);
  if (sp.notify) { const n = sp.notify; fx.push({ type: 'notify', title: n.title || '알림', body: n.text, col: sp.col, t0: T + (n.at ?? .75), life: n.life || 1.9 }); later(n.at ?? .75, () => A.voice(n.voice)); }   // 직장인: 월급 입금 알림
  if (sp.voiceAt == null) A.voice(sp.voice); A.sfx('charge'); A.duck(.1);
  f.sy = .88; tw(f, { sy: 1 }, .4, 'back');
}
function endFreeze(f) {
  tw(cam, { zoom: 1, x: W / 2, y: H / 2, rot: 0 }, .22, 'in', true); tw(overlay, { dark: 0, speed: 0 }, .25); tw(ex, { burst: 0 }, .25); A.duck(.28, .6);
  const sp = f.sp.def, v = sp.vfx || {}; f.pose = sp.pose || f.pose; tw(f, { glow: 0 }, .6);
  f.ox = f.dir * 30; tw(f, { ox: 0 }, .3);
  if (v.type === 'projectile') spawnProj(f, v, sp.dmg, v.y);
  else if (v.type === 'multi') { f.sp.shots = 0; }
  else if (v.type === 'whirl') { G.proj.push({ kind: 'whirl', owner: f, x: f.x + f.dir * 170, y: GROUND, vx: f.dir * (v.speed || 10), hits: v.hits || 4, hitsLeft: v.hits || 4, cd: 0, dmg: sp.dmg, col: v.hitColor || '#fff', t: 0, on: 0, cine: sp.cine, sp: true, petal: !!v.petal }); A.sfx('wind'); tw(G.proj[G.proj.length - 1], { on: 1 }, .3); }
  else if (v.type === 'siren') { f.sp.sirenAt = v.delay || 40; A.sfx('ring'); }
  else if (v.type === 'fistrain') {   // 10/2 할머니 "생활근육!": 하늘에서 꿀밤 주먹이 우수수 → 마지막에 대왕 주먹
    const o = opp(f), n = v.count || 8;
    for (let i = 0; i < n; i++) later(i * (v.gap || .09), () => { if (!G || G.phase !== 'fight') return; const last = i === n - 1;
      G.proj.push({ kind: 'shot', owner: f, img: v.img || 'k_fist', x: o.x + (last ? 0 : (rnd() - .5) * 420), y: GROUND - 1150 - rnd() * 150, vx: f.dir * .5, vy: last ? 30 : 34 + rnd() * 10, g: .9, floorY: GROUND - 50,
        size: (last ? (v.bigSize || 640) : (v.size || 300) * (.8 + rnd() * .5)), dmg: last ? sp.dmg * .45 : sp.dmg * .55 / (n - 1), light: !last, fin: last, rotDown: true,
        col: v.hitColor || '#ffd23f', t: 0, s: 1, cine: 'fistrain', sp: true }); A.sfx('whoosh'); });
  }
  if (sp.anim) f.pose = sp.anim[0][0];
  if (sp.fireVoice) A.voice(sp.fireVoice);   // 직장인: 동전 쏟아지는 소리
  A.sfx('whoosh');
  const cn = CINE[sp.cine]; if (cn && cn.fire0) cn.fire0(f, f.sp);
  // 10/2 모든 필살기 공통 화려함: 발사 순간 몸 둘레로 색 고리 3겹 + 반짝이 + 별가루 (방사형 광선 없음)
  const bc = sp.burstCol || [sp.col, sp.col2 || '#fff'], cy = GROUND - 300;
  for (let i = 0; i < 3; i++) fx.push({ type: 'ring', x: f.x, y: cy, t0: T + i * .06, life: .55, r: 220 + i * 140, col: i === 1 ? '#ffffff' : bc[i % 2], lw: 20 - i * 5 });
  for (let i = 0; i < 36; i++) { const a = rnd() * Math.PI * 2, v2 = 300 + rnd() * 900; fx.push({ type: 'dot', x: f.x + f.dir * 80, y: cy, vx: Math.cos(a) * v2 + f.dir * 300, vy: Math.sin(a) * v2 - 200, t0: T + rnd() * .1, life: .5 + rnd() * .5, r: 6 + rnd() * 10, col: [bc[0], bc[1], '#ffffff', '#ffe600'][i % 4] }); }
  overlay.white = Math.max(overlay.white || 0, .35); tw(overlay, { white: 0 }, .25, 'lin', true);
}
// ---------- 필살기 준비 동작 (멈춘 화면에서: 경례 "충성!" · "마감!" 외치고 안경 벗기) ----------
function specialPre(f) {
  const sp = f.sp, d = sp.def, t = sp.t;
  if (d.pre) { let p = null; for (const [ps, at] of d.pre) if (t >= at) p = ps; if (p && p !== f.pose) { f.pose = p; f.sy = .94; tw(f, { sy: 1 }, .2, 'back'); } }
  if (d.voiceAt != null && t === d.voiceAt) A.voice(d.voice);
  const cn = CINE[d.cine]; if (cn && cn.pre) cn.pre(f, sp, t);
  if (d.shout && t === (d.shoutAt ?? d.voiceAt ?? 72)) { say(f, d.shout, 1.1); cam.shake = 10; fx.push({ type: 'ring', x: f.x + f.dir * 40, y: headY(f) + 60, t0: T, life: .35, r: 260, col: d.col, lw: 16 }); }
  if (d.glintAt != null && t === d.glintAt) {   // 안경 벗는 순간 렌즈 반짝
    const fp = facePt(f), gx = fp.x + f.dir * 14, gy = fp.y - 6;   // 눈(안경) 높이
    fx.push({ type: 'flash', x: gx, y: gy, t0: T, life: .25, r: 26 }); fx.push({ type: 'ring', x: gx, y: gy, t0: T, life: .35, r: 70, col: '#fff', lw: 6 });   // 작은 둥근 반짝임
    for (let i = 0; i < 8; i++) { const a = rnd() * Math.PI * 2, s = 120 + rnd() * 220; fx.push({ type: 'dot', x: gx, y: gy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 250, t0: T, life: .5, r: 5 + rnd() * 6, col: rnd() > .5 ? '#fff' : d.col }); }
    A.sfx('sparkle');
  }
}
// ---------- 군인: 만화 총 (둥근 총구 불꽃 · 캡슐 총알 · 가로 속도선) ----------
// 몇 번째 총알이 몇 프레임에 나가는지: slowFrom 번째부터는 슬로모션 안에서 촘촘히(gapSlow)
function gunShotT(v, i) { const at = v.at || 8, gap = v.gap || 8, sf = v.slowFrom ?? 99; return at + Math.min(i, sf) * gap + Math.max(0, i - sf) * (v.gapSlow || 3); }
function gunTick(f, v, sp) {
  const n = v.shots || 3, at = v.at || 8, d = sp.def;
  for (let i = 0; i < n; i++) if (sp.t === gunShotT(v, i)) {
    const last = i === n - 1, mx = f.x + f.dir * (v.mx || 240), my = GROUND - (v.y || 440), big = last ? (v.lastBig || 1) : 1;
    if (v.slowFrom != null && i === v.slowFrom) CINE.gun.bulletTime(f, v, sp, mx, i);   // 총알 시간(슬로모션) 시작
    G.proj.push({ kind: 'shot', owner: f, img: 'bullet', x: mx + f.dir * 30, y: my, vx: f.dir * (v.speed || 36), size: (v.size || 120) * big, dmg: last ? d.dmg * (1 - .12 * (n - 1)) : d.dmg * .12,
      col: v.hitColor || '#ffd23f', light: !last, big, t: 0, s: 1, slowShot: v.slowFrom != null && i >= v.slowFrom, fin: last, cine: d.cine, sp: true });
    fx.push({ type: 'muzzle', x: mx, y: my, dir: f.dir, t0: RT, rt: true, life: .14, r: 70 * Math.min(big, 1.4) });   // 총구 불꽃은 실제 시간으로 (슬로모션에서 너무 오래 남지 않게)
    for (let k = 0; k < 4; k++) fx.push({ type: 'streak', x: mx - f.dir * (20 + k * 30), y: my + (rnd() - .5) * 90, dir: f.dir, t0: T, life: .2, len: 120 + rnd() * 120 });
    // 10/2 간지: 탄피가 위로 튀고(금색 캡슐) · 총구 연기 · 반동 섬광
    for (let k = 0; k < (last ? 3 : 1); k++) fx.push({ type: 'dot', x: f.x + f.dir * 60, y: my + 20, vx: -f.dir * (250 + rnd() * 250), vy: -700 - rnd() * 300, t0: T, life: .7, r: 9, col: '#ffcf3a' });
    for (let k = 0; k < 3; k++) fx.push({ type: 'ring', x: mx + f.dir * (40 + k * 30), y: my - k * 14, t0: T + k * .04, life: .45, r: 60 + k * 30, col: 'rgba(230,230,230,.7)', lw: 10 - k * 2 });
    if (last) { overlay.white = .55; tw(overlay, { white: 0 }, .18, 'lin', true); }
    f.pose = d.pose; f.ox = -f.dir * (last ? 34 : 20); tw(f, { ox: 0 }, .14); cam.shake = Math.max(cam.shake, last ? 16 : 9); A.sfx('pew');
    sp.lastShot = sp.t;
  }
  if (sp.lastShot != null && sp.t - sp.lastShot === Math.min(5, v.gapSlow || 5) && sp.t < gunShotT(v, n - 1)) f.pose = v.aimPose || f.pose;   // 쏘고 → 다시 겨누기
}
function gunEnd(v) { return gunShotT(v, (v.shots || 3) - 1) + 28; }
// ---------- 예술가: 안경 던지기 (빙글빙글 날아가서 맞고 → 주인에게 되돌아옴) ----------
function spawnGlasses(f, v, dmg) {
  const loops = v.loops || 1;   // loops 2 = 맞히고 지나가서 되돌아오며 한 번 더
  G.proj.push({ kind: 'shot', owner: f, img: 'glasses', x: f.x + f.dir * (v.mx || 200), y: GROUND - (v.y0 || 380), ty: GROUND - (v.y || 330), vx: f.dir * (v.speed || 24), size: v.size || 200,
    dmg: dmg / loops, col: v.hitColor || '#ff7ac0', boomerang: true, x0: f.x, range: v.range || 1150, t: 0, s: .4, hitLeft: loops, keep: loops > 1, fin: loops === 1, trail: true, cine: f.sp && f.sp.def.cine, sp: true });
  tw(G.proj[G.proj.length - 1], { s: 1 }, .15); A.sfx('spin');
}
function drawGlasses(p) {   // 안경을 코드로 그림: 동그란 금테 두 알 + 다리, 렌즈 반짝
  if (p.trail && !p._ghost) { const dir = Math.sign(p.vx) || 1;   // 날아가는 잔상 (가로로)
    for (let i = 3; i >= 1; i--) { ctx.save(); ctx.globalAlpha = .16 * (4 - i) / 3; drawGlasses(Object.assign({}, p, { _ghost: true, x: p.x - dir * i * p.size * .28, t: p.t - i * 2 })); ctx.restore(); } }
  const w = p.size * p.s, r = w * .22, spin = p.t * .45 * (p.ret ? -1 : 1);
  // 9/29 예술가 재디자인에 맞춤: 검은 뿔테 안경 (두꺼운 둥근 네모 테 + 다리)
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(spin); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const gl = ctx.createRadialGradient(0, 0, r * .3, 0, 0, w * .75); gl.addColorStop(0, 'rgba(255,240,250,.5)'); gl.addColorStop(1, 'rgba(255,120,200,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, w * .75, 0, 7); ctx.fill();
  const lw = r * 2.25, lh = r * 1.7, rr = r * .55;
  for (const sx of [-1, 1]) {
    const cx = sx * w * .27;
    ctx.beginPath(); ctx.roundRect(cx - lw / 2, -lh / 2, lw, lh, rr); ctx.fillStyle = 'rgba(190,230,255,.5)'; ctx.fill();
    ctx.lineWidth = w * .085; ctx.strokeStyle = '#0d0d0f'; ctx.stroke();
    ctx.lineWidth = w * .018; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.roundRect(cx - lw / 2 + w * .02, -lh / 2 + w * .02, lw - w * .04, lh * .5, rr * .7); ctx.stroke();   // 뿔테 윤기
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.ellipse(cx - lw * .2, -lh * .18, lw * .16, lh * .1, -.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + lw * .22, lh * .16, r * .08, 0, 7); ctx.fill();
    ctx.lineWidth = w * .06; ctx.strokeStyle = '#0d0d0f'; ctx.beginPath(); ctx.moveTo(sx * (w * .27 + lw / 2), -lh * .3); ctx.lineTo(sx * w * .6, -lh * .55); ctx.stroke();
  }
  ctx.lineWidth = w * .07; ctx.strokeStyle = '#0d0d0f'; ctx.beginPath(); ctx.moveTo(-w * .27 + lw / 2, -lh * .12); ctx.quadraticCurveTo(0, -lh * .38, w * .27 - lw / 2, -lh * .12); ctx.stroke();
  ctx.restore();
}
function drawBullet(p) {   // 둥근 캡슐 총알 + 가로 잔상
  const dir = Math.sign(p.vx) || 1, L = p.size * p.s, h = L * .42;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(dir, 1); ctx.lineCap = 'round';
  if (p.slowShot && slow.k < 1) {   // 총알 시간: 뒤로 길게 끌리는 가로 꼬리
    const len = 900, g = ctx.createLinearGradient(0, 0, -len, 0); g.addColorStop(0, 'rgba(255,240,170,.85)'); g.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.strokeStyle = g; ctx.lineWidth = h * .9; ctx.beginPath(); ctx.moveTo(-L * .2, 0); ctx.lineTo(-len, 0); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.7)'; for (const yy of [-h * 1.1, h * 1.1]) { ctx.beginPath(); ctx.moveTo(-L * .4, yy); ctx.lineTo(-len * .6, yy); ctx.stroke(); } }
  if (!(p.slowShot && slow.k < 1)) { const len = 520, g = ctx.createLinearGradient(0, 0, -len, 0); g.addColorStop(0, 'rgba(255,220,120,.8)'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.strokeStyle = g; ctx.lineWidth = h * .55; ctx.beginPath(); ctx.moveTo(-L * .2, 0); ctx.lineTo(-len, 0); ctx.stroke(); }   // 10/2 예광탄 꼬리
  ctx.globalCompositeOperation = 'lighter'; for (let i = 1; i <= 3; i++) { ctx.globalAlpha = .3 / i; ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = h * (1 - i * .2); ctx.beginPath(); ctx.moveTo(-L * .2, 0); ctx.lineTo(-L * (.6 + i * .5), 0); ctx.stroke(); }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.moveTo(-L * .35, -h / 2); ctx.lineTo(L * .2, -h / 2); ctx.arc(L * .2, 0, h / 2, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-L * .35, h / 2); ctx.arc(-L * .35, 0, h / 2, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
  ctx.fillStyle = '#ffc93a'; ctx.fill(); ctx.lineWidth = Math.max(4, h * .16); ctx.strokeStyle = '#3a1a00'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(0, -h * .18, L * .3, h * .11, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function spawnProj(f, v, dmg, y) {   // 필살기 발사체. v.from = { dx, dy } 시작 위치(몸 기준), v.vy · v.g = 포물선(위에서 떨어지기)
  const fr = v.from || { dx: 150, dy: y || 300 }, df = f.sp && f.sp.def;
  const p = { kind: 'shot', owner: f, img: v.img, coins: !!v.coins, x: f.x + f.dir * fr.dx, y: GROUND - fr.dy, vx: f.dir * (v.speed || 20), size: v.size || 400, dmg, col: v.hitColor || '#fff', spin: !!v.spin, t: 0, s: .35,
    sp: true, fin: true, cine: df && df.cine };
  if (v.vy != null) { p.vy = v.vy; p.g = v.g || 0; p.floorY = GROUND - (v.floor || 150); }
  G.proj.push(p); tw(p, { s: 1 }, .18);
  if (v.img === 'fire') A.sfx('fire');
  return p;
}

// =====================================================================
//  필살기 연출 도구 (다른 캐릭터도 가져다 쓸 수 있게) — 2026-09-29
//  slowMo(속도, 초) 슬로모션 · camTo/camFollow 카메라 줌·기울기 · cineMood(흑백, 검은 띠) · stamp 도장 글자
//  papers 종이 · coinRain 동전 비 · drops 물방울 · puff 김 · shockwave 둥근 충격파 · heartbeat 심장 소리
//  모양 규칙: 둥근 충격파 · 둥근 반짝임 · 종이 · 가로 속도선만 (방사형 광선 없음)
//  예술가 첫 대사는 characters.js 의 superLines 중 무작위
//  CINE[이름] = { start, pre(준비 동작, 실제 프레임), fire0(발사 순간), tick(발사 뒤 매 프레임), frame(매 화면), draw(그리기), hit(맞음), knock(날려 보내기), siren, land }
//  characters.js 의 필살기에 cine: '이름' 을 적으면 연결됨. 제한 시간은 필살기 동안 멈춤
// =====================================================================
function slowMo(k, sec) { slow.to = k; slow.k = Math.min(slow.k, k + .25); slow.left = sec; }
function slowSnap() { slow.left = 0; slow.to = 1; slow.k = 1; }
function stepSlow() { if (slow.left > 0) { slow.left -= DT; slow.k += (slow.to - slow.k) * .35; if (slow.left <= 0) slow.to = 1; } else if (slow.k < 1) slow.k = Math.min(1, slow.k + .1); }
function camClamp(z, x, y) { const hw = W / 2 / z, hh = H / 2 / z; return [clamp(x, hw - 30, W - hw + 30), clamp(y, hh - 30, H - hh + 30)]; }
function camTo(zoom, x, y, dur = .3, rot = 0) { const [cx, cy] = camClamp(zoom, x, y); tw(cam, { zoom, x: cx, y: cy, rot }, dur, 'io', true); }
function camFollow(x, y, zoom, rate = .12, rot = 0) { tweens = tweens.filter(t => t.o !== cam); cam.zoom += (zoom - cam.zoom) * rate; const [cx, cy] = camClamp(cam.zoom, x, y); cam.x += (cx - cam.x) * rate; cam.y += (cy - cam.y) * rate; cam.rot += (rot - cam.rot) * rate; }
function cineMood(desat, bars, dur = .25) { tw(cine, { desat, bars }, dur, 'out', true); }
function cineEnd() { slowSnap(); cineMood(0, 0, .3); tw(cam, { zoom: 1, x: W / 2, y: H / 2, rot: 0 }, .3, 'out', true); }
function stamp(str, o = {}) {   // 도장 글자: 크게 떨어져 쾅! + 둥근 잉크 방울
  const dots = []; for (let i = 0; i < 14; i++) { const a = rnd() * Math.PI * 2, r2 = .58 + rnd() * .2; dots.push({ x: Math.cos(a) * r2, y: Math.sin(a) * r2, r: 6 + rnd() * 18 }); }
  fx.push({ type: 'stamp', str, sub: o.sub, x: o.x ?? W / 2, y: o.y ?? 380, size: o.size || 200, col: o.col || '#e0182d', rot: o.rot ?? -.1, t0: RT, rt: true, life: o.life || 1.6, dots });
  rlater(.12, () => { cam.shake = Math.max(cam.shake, o.shake ?? 28); A.sfx('stamp'); });
}
function papers(x, y, n, o = {}) {   // 원고 종이: orbit = 몸 둘레를 빙글빙글, 아니면 사방으로 흩날림
  for (let i = 0; i < n; i++) fx.push({ type: 'paper', x: x + (rnd() - .5) * 60, y: y + (rnd() - .5) * 80, vx: (rnd() - .5) * (o.v || 1400), vy: -250 - rnd() * (o.v || 1400) * .55, rot: rnd() * 6, vr: (rnd() - .5) * 9, w: 60 + rnd() * 34, ph: rnd() * 6,
    t0: T, life: o.life || 1.4, orbit: o.orbit ? { cx: x, cy: y, r: o.orbit * (.65 + rnd() * .6), a0: rnd() * 6.28, va: (2.4 + rnd() * 1.6) * (o.dir || 1), rise: o.flat ? 0 : 20 + rnd() * 70, dy: (rnd() - .5) * (o.flat ? 120 : 260) } : null });
  A.sfx('paper');
}
function shockwave(x, y, big = 1, col = '#fff') { for (let i = 0; i < 4; i++) fx.push({ type: 'ring', x, y, t0: T + i * .06, life: .5 + i * .12, r: (260 + i * 170) * big, col: i % 2 ? '#ffffff' : col, lw: 26 - i * 4 }); fx.push({ type: 'flash', x, y, t0: T, life: .18, r: 140 * big }); }
function drops(x, y, n, col = '#7fe8ff', v = 900) { for (let i = 0; i < n; i++) { const a = -Math.PI * rnd(), s2 = v * (.3 + rnd() * .7); fx.push({ type: 'dot', x, y, vx: Math.cos(a) * s2, vy: Math.sin(a) * s2, t0: T, life: .6 + rnd() * .4, r: 5 + rnd() * 10, col: rnd() < .3 ? '#ffffff' : col }); } }
function crumbs(x, y, n) { for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, s2 = 200 + rnd() * 600; fx.push({ type: 'dot', x, y, vx: Math.cos(a) * s2, vy: Math.sin(a) * s2 - 250, t0: T, life: .5 + rnd() * .4, r: 5 + rnd() * 9, col: pick(['#c8741e', '#e8a64a', '#ffd78a', '#8a4a12']) }); } }
function coinRain(x, n) { for (let i = 0; i < n; i++) fx.push({ type: 'coin', x: x + (rnd() - .5) * 760, y: -80 - rnd() * 160, vy: 150 + rnd() * 300, t0: T + rnd() * .7, life: 1.5, r: 20 + rnd() * 12, ph: rnd() * 6 }); A.sfx('coins'); }
function puff(x, y) { fx.push({ type: 'puff', x: x + (rnd() - .5) * 40, y, vx: (rnd() - .5) * 50, t0: T, life: .9 + rnd() * .5, r: 16 + rnd() * 14 }); }
function heartbeat(times = 3, gap = .45) { for (let i = 0; i < times; i++) rlater(i * gap, () => A.sfx('heart')); }
function buoyPos(f, s) { const a = -2.75 + s * 3.05, r = 250; return { x: f.x - f.dir * 20 + Math.cos(a) * r * f.dir, y: GROUND - 340 + Math.sin(a) * r * .85, a }; }
const cutF = sp => sp.def.cutinF || 72;
const CINE = {
  // ---------- 10/2 학생 "센치멘탈": 시간이 느려지고 화면 가득 벚꽃잎 · 맞으면 분홍 빛 ----------
  senti: {
    start() { cineMood(.1, .6, .4); },
    pre(f, sp, t) { if (t === cutF(sp)) { slowMo(.45, 1.3); camTo(1.25, f.x + f.dir * 120, GROUND - 420, .5); A.sfx('slow'); }
      if (t >= cutF(sp) && t % 2 === 0) for (let i = 0; i < 3; i++) fx.push({ type: 'dot', x: rnd() * W, y: -40 - rnd() * 200, vx: -120 - rnd() * 160, vy: 60 + rnd() * 90, t0: T, life: 1.6, r: 7 + rnd() * 8, col: ['#ffc2dc', '#ff9cc8', '#ffffff'][i] }); },
    fire0(f) { slowSnap(); tw(cam, { zoom: 1, x: W / 2, y: H / 2, rot: 0 }, .4, 'out', true); for (let i = 0; i < 50; i++) fx.push({ type: 'dot', x: rnd() * W, y: -60 - rnd() * 300, vx: -100 - rnd() * 200, vy: 80 + rnd() * 120, t0: T + rnd() * .5, life: 1.8, r: 8 + rnd() * 9, col: ['#ffc2dc', '#ff9cc8', '#ffffff', '#ffd6e8'][i % 4] }); },
    hit(f, d, p, fin) { if (!fin) return; shockwave(d.x, GROUND - 320, 1.6, '#ff9cc8'); fx.push({ type: 'ring', x: d.x, y: GROUND - 320, t0: T + .1, life: .8, r: 900, col: '#ffd6e8', lw: 30 });
      rlater(.1, () => text('센치멘탈…♪', { size: 170, life: 1.6, x: clamp(d.x, 400, W - 400), y: GROUND - 640, col: '#ffd6e8', stroke: '#7a2a5a', rot: -.05 })); overlay.white = .5; tw(overlay, { white: 0 }, .6, 'lin', true); },
    siren(f, d) { text('말 걸지 마세요.', { size: 150, life: 1.8, y: 330, rot: -.04, col: '#bfe0ff', stroke: '#0a1440' }); for (let i = 0; i < 5; i++) fx.push({ type: 'ring', x: f.x, y: GROUND - 380, t0: T + i * .08, life: .7, r: 300 + i * 220, col: i % 2 ? '#ffffff' : '#7fb2ff', lw: 18 }); },
  },
  // ---------- 10/2 알바생: "집에 가고 싶다" 폭풍 → 맞으면 하얗게 터지며 "퇴근!!" 도장 (카타르시스) ----------
  quit: {
    start() { cineMood(.2, .6, .3); },
    fire0(f) { cam.shake = 24; for (let i = 0; i < 8; i++) fx.push({ type: 'streak', x: f.x + f.dir * (100 + i * 60), y: GROUND - 200 - rnd() * 400, dir: f.dir, t0: T + i * .03, life: .35, len: 300 + rnd() * 200 }); },
    hit(f, d, p, fin) { if (!fin) return; overlay.white = 1; tw(overlay, { white: 0 }, .7, 'lin', true); G.hitstop = 22; cam.shake = 60;
      shockwave(d.x, GROUND - 300, 2.2, '#5affc8'); rlater(.15, () => shockwave(d.x, GROUND - 300, 1.4, '#ffe600'));
      rlater(.3, () => stamp('퇴근!!', { sub: '오늘은 여기까지', size: 230, y: 300, x: f.x < W / 2 ? W - 460 : 460, rot: -.12, col: '#0a8a6a' })); },
    siren(f, d) { overlay.white = .9; tw(overlay, { white: 0 }, .5, 'lin', true); cam.shake = 50; text('사장님 말 걸지 마세요!!', { size: 120, life: 1.8, y: 320, rot: -.04, col: '#ff5a6a', stroke: '#1a1a3a' });
      rlater(.35, () => stamp('퇴근', { sub: '알바 끝', size: 220, y: 560, x: W / 2, rot: .08, col: '#ff3a4a' })); },
  },
  // ---------- 10/2 연구원: 초록 거품 실험실 · "발견!" 전구 번쩍 · "실험 성공!" 도장 ----------
  lab: {
    start() { cineMood(.3, .7, .3); },
    pre(f, sp, t) { if (t >= cutF(sp) && t % 2 === 0) for (let i = 0; i < 2; i++) fx.push({ type: 'dot', x: rnd() * W, y: H + 20, vx: (rnd() - .5) * 60, vy: -500 - rnd() * 400, t0: T, life: 1.2, r: 6 + rnd() * 14, col: ['#7fff6a', '#c9a6ff'][i] }); },
    fire0(f) { for (let i = 0; i < 4; i++) fx.push({ type: 'ring', x: f.x, y: GROUND - 320, t0: T + i * .07, life: .6, r: 260 + i * 160, col: i % 2 ? '#c9a6ff' : '#7fff6a', lw: 16 }); },
    hit(f, d, p, fin) { if (!fin) return; shockwave(d.x, GROUND - 300, 1.8, '#7fff6a'); rlater(.12, () => shockwave(d.x, GROUND - 300, 1.2, '#c9a6ff'));
      rlater(.3, () => stamp('실험 성공!', { sub: 'p < 0.05', size: 170, y: 290, x: f.x < W / 2 ? W - 480 : 480, rot: -.1, col: '#2a8a2a' })); },
    siren(f, d) { overlay.white = 1; tw(overlay, { white: 0 }, .8, 'lin', true); cam.shake = 40; text('유레카!!', { size: 220, life: 1.6, y: 300, rot: -.05, col: '#ffe600', stroke: '#2a0a4a' });
      for (let i = 0; i < 6; i++) fx.push({ type: 'ring', x: f.x + f.dir * 20, y: GROUND - 640, t0: T + i * .06, life: .7, r: 160 + i * 150, col: i % 2 ? '#ffffff' : '#ffe600', lw: 16 });
      rlater(.35, () => stamp('발견!', { sub: '논문 각', size: 210, y: 560, x: W / 2, rot: .07, col: '#7a2ad8' })); },
  },
  // ---------- 할머니 "생활근육!": 떨어진 주먹이 땅에 쿵 ----------
  fistrain: {
    land(f, p) { p.dead = true; shockwave(p.x, GROUND - 30, p.fin ? 1.4 : .55, '#ffd23f'); dust(p.x, 1, p.fin ? 16 : 6); dust(p.x, -1, p.fin ? 16 : 6); cam.shake = Math.max(cam.shake, p.fin ? 40 : 14); A.sfx(p.fin ? 'stomp' : 'hit');
      if (p.fin) rlater(.1, () => text('꿀밤!!', { size: 260, life: 1.1, x: clamp(p.x, 320, W - 320), y: GROUND - 560, col: '#ffe600', stroke: '#ff2f8a', rot: -.06 })); },
    hit(f, d, p, fin) { if (fin) { text('꿀밤!!', { size: 260, life: 1.1, x: clamp(d.x, 320, W - 320), y: GROUND - 600, col: '#ffe600', stroke: '#ff2f8a', rot: -.06 }); cam.shake = 50; } },
  },
  // ---------- 군인 "충성!": 경례 → 겨누기 → 총알 시간(아주 느리게, 총알 따라 카메라) → "팡!" 원래 속도
  gun: {
    start() { cineMood(.2, .5, .3); },
    pre(f, sp, t) { const end = cutF(sp) + (sp.def.hold || 0); if (t === end - 12) camTo(1.3, f.x + f.dir * 300, GROUND - 450, .25); },
    fire0() { tw(cam, { zoom: 1.12, x: cam.x, y: cam.y }, .2, 'out', true); },
    bulletTime(f, v, sp, mx) {   // 이 총알부터 슬로모션: 마지막 총알이 약 1.2초 걸려 닿게 속도를 맞춤
      const o = opp(f), n = v.shots || 3, rest = (n - 1 - v.slowFrom) * (v.gapSlow || 3), dist = Math.max(120, Math.abs(o.x - mx) - o.C.body.hw);
      const k = clamp((rest + dist / (v.speed || 38)) / 74, .12, .45);
      slowMo(k, 2.2); cineMood(.78, 1, .12); heartbeat(3, .42); A.sfx('slow'); sp.bt = true;
    },
    frame(f, sp) {
      if (!sp.bt || slow.k >= .999) return;
      let p = null; for (const q of G.proj) if (q.owner === f && q.img === 'bullet' && !q.dead) p = q;
      if (p) camFollow(p.x - f.dir * 170, p.y + 60, 1.75, .12, -.05 * f.dir);
    },
    hit(f, d, p, fin) {
      if (!fin) return;
      if (f.sp) f.sp.bt = false; slowSnap(); cineMood(0, 0, .2); tw(cam, { zoom: 1, x: W / 2, y: H / 2, rot: 0 }, .28, 'out', true);
      const tx = clamp(d.x, 320, W - 320); rlater(.12, () => text('팡!', { size: 320, life: 1.1, x: tx, y: GROUND - 600, col: '#ffe600', stroke: '#ff2f8a', rot: -.08 }));
      shockwave(d.x, p.y, 1.3, '#ffd23f'); dust(d.x, Math.sign(p.vx) || 1, 18); cam.shake = 50; A.sfx('pang'); G.hitstop = 14;
      rlater(.35, () => { stamp('명중!', { sub: '충성!', size: 170, y: 260, x: f.x < W / 2 ? W - 420 : 420, rot: -.1 }); shockwave(d.x, p.y, 2, '#d8ff5a'); });   // 10/2 군인 뽕: 명중 도장 + 한 겹 더
    },
    knock(f, d, dir) { d.vx = dir * 24; d.vy = -19; },
  },
  // ---------- 예술가 "작업 마감!": "예술가 아무나 하냐?!" → "작업 마감!" D-0 도장 + 원고 소용돌이 → 안경 벗기 슬로모션 클로즈업 → 던지기 → "마감 완료!" 도장 + 종이 폭발
  deadline: {
    start() { cineMood(.15, .5, .3); },
    draw(f, sp) {   // 10/2 광기 모드: 필살기 동안 눈이 빨갛게 번쩍 + 눈에서 빨간 빛 꼬리 + 붉은 기운
      const spr = SPR[f.key + '/' + f.pose]; if (!spr || !spr.head) return;
      const fl = f.dir * f.C.facing * (spr.flip ? -1 : 1), hd = spr.head, hx = f.x + hd.x * fl, ey = f.y + hd.y + hd.size * 1.05, pul = .75 + Math.sin(RT * 30) * .25;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const au = ctx.createRadialGradient(f.x, f.y - 280, 40, f.x, f.y - 280, 420); au.addColorStop(0, `rgba(255,30,60,${.28 * pul})`); au.addColorStop(1, 'rgba(255,0,40,0)'); ctx.fillStyle = au; ctx.fillRect(f.x - 440, f.y - 720, 880, 720);
      for (const ex2 of [hx + f.dir * 12, hx + f.dir * 46]) {
        const tr = ctx.createLinearGradient(ex2, ey, ex2 - f.dir * 260, ey + 18); tr.addColorStop(0, `rgba(255,40,70,${.9 * pul})`); tr.addColorStop(1, 'rgba(255,40,70,0)');
        ctx.strokeStyle = tr; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ex2, ey); ctx.lineTo(ex2 - f.dir * 260, ey + 18); ctx.stroke();
        const gl = ctx.createRadialGradient(ex2, ey, 2, ex2, ey, 30 * pul); gl.addColorStop(0, '#ffffff'); gl.addColorStop(.35, '#ff2a4a'); gl.addColorStop(1, 'rgba(255,0,40,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(ex2, ey, 30 * pul, 0, 7); ctx.fill(); }
      ctx.restore();
    },
    pre(f, sp, t) {
      const c = cutF(sp);
      if (t === c) { const ln = pick(f.C.superLines || [{ text: '예술가 아무나 하냐?!', voice: 'a_nobody' }]); say(f, ln.text, 1.45); A.voice(ln.voice);   // 첫 대사는 할 때마다 무작위 (말풍선 = 목소리)
        camTo(1.45, f.x + f.dir * 70, headY(f) + 250, .35); cineMood(.35, .9, .3); f.sy = .95; tw(f, { sy: 1 }, .3, 'back', true); }
      if (t === c + 80) {
        say(f, '작업 마감!', 1.1); if (!A.voice('a_workdeadline')) A.voice('a_deadline');
        stamp('D-0', { sub: '작업 마감', size: 190, y: 250, x: f.x < W / 2 ? W - 430 : 430, rot: -.13 });
        papers(f.x, GROUND - 200, 16, { orbit: 300, life: 2.3, dir: f.dir, flat: true }); fx.push({ type: 'ring', x: f.x, y: GROUND - 300, t0: T, life: .5, r: 440, col: '#e0182d', lw: 22 });
        camTo(1.2, f.x + f.dir * 90, GROUND - 420, .2);
      }
      if (t === c + 108) { slowMo(.25, .8); camTo(1.9, f.x + f.dir * 8, headY(f) + 70, .3); cineMood(.65, 1, .2); A.sfx('slow'); }
    },
    fire0() { slowSnap(); cineMood(.15, .5, .15); },
    hit(f, d, p, fin) {
      papers(d.x, p.y, fin ? 24 : 10, { v: fin ? 1600 : 900, life: 1.3 });
      if (!fin) { cam.shake = Math.max(cam.shake, 20); return; }
      if (f.sp) f.sp.hitAt = f.sp.t;
      stamp('마감 완료!', { size: 170, y: 300, rot: .08, x: clamp(d.x, 460, W - 460), life: 1.5 });
      shockwave(d.x, p.y, 1.15, '#ff2f8a'); cam.shake = 36; cineMood(0, 0, .3);
    },
  },
  // ---------- 초딩 R1 "고래빵 혼자 먹기": 슬로모션 한 입(김·부스러기·볼 빵빵) "냠!" → 거대 고래빵이 하늘에서 쾅
  whale: {
    start() { cineMood(.2, .5, .3); },
    pre(f, sp, t) {
      const c = cutF(sp), hx = f.x + f.dir * 95, hy = headY(f) + 185;
      if (t === c) { camTo(1.95, f.x + f.dir * 50, headY(f) + 190, .35); slowMo(.3, 1.6); cineMood(.35, 1, .3); sp.bread = 1; sp.breadT = RT; A.sfx('slow'); }
      if (sp.bread && t % 4 === 0) puff(hx + f.dir * 30, hy - 60);
      if (t === c + 40) { stamp('냠!', { size: 200, col: '#ff7a00', x: clamp(f.x + f.dir * 480, 320, W - 320), y: headY(f) + 40, rot: -.12 * f.dir, life: 1.3 }); sp.chomp = RT; A.sfx('chomp'); crumbs(hx, hy - 40, 22); f.sx = 1.1; tw(f, { sx: 1 }, .4, 'back', true); }
      if (t === c + 88) { slowSnap(); sp.bread = 0; camTo(1.1, (f.x + opp(f).x) / 2, GROUND - 500, .25); cineMood(.1, .5, .2); A.sfx('whoosh'); }
    },
    draw(f, sp) {
      if (!sp.bread) return; const img = IMG.vfx_whale; if (!img) return;
      const bt = RT - sp.breadT, ch = sp.chomp ? RT - sp.chomp : -1, sq = ch >= 0 && ch < .25 ? 1 - Math.sin(ch / .25 * Math.PI) * .12 : 1;
      const spr = SPR[f.key + '/' + f.pose], fl = f.dir * f.C.facing * (spr && spr.flip ? -1 : 1), hd = spr && spr.head, hx = hd ? f.x + hd.x * fl : f.x, hy = hd ? f.y + hd.y + hd.size * 1.25 : headY(f) + 150;
      const w = 300 * sq, h = w * img.height / img.width, x = hx + f.dir * 125, y = hy + 10 + Math.sin(bt * 5) * 4;
      ctx.save(); ctx.translate(x, y); ctx.scale(f.dir, 1); ctx.rotate(-.18); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
      if (ch >= 0) { const k = Math.min(1, ch / .18), pf = 1 + .25 * Math.sin(Math.min(1, ch / .5) * Math.PI);   // 볼 빵빵 (분홍 동그라미)
        const cx = x - f.dir * (w * .5 + 14), cy = y - 16;   // 빵을 문 쪽 볼 (옆모습이라 한쪽만)
        ctx.save(); ctx.globalAlpha = .55 * k; ctx.fillStyle = '#ff6a9a'; ctx.beginPath(); ctx.ellipse(cx, cy, 20 * pf, 15 * pf, 0, 0, 7); ctx.fill(); ctx.globalAlpha = .7 * k; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - 6, cy - 5, 4, 0, 7); ctx.fill(); ctx.restore(); }
    },
    fire0(f, sp) {   // 하늘에서 거대 고래빵이 상대에게 떨어짐 (30프레임)
      const o = opp(f), x0 = f.x - f.dir * 120, y0 = GROUND - 980, tt = 30, g = 1.2, vy = (730 - g * tt * tt / 2) / tt;
      const p = spawnProj(f, { img: 'whale', size: 700, speed: 0, spin: false, hitColor: 'rgb(255,200,60)' }, sp.def.dmg, 0);
      p.x = x0; p.y = y0; p.vx = (o.x - x0) / tt; p.vy = vy; p.g = g; p.floorY = GROUND - 250; p.crash = true;
      overlay.speedX = f.dir < 0 ? 1 : 0; A.sfx('fall');
      for (let i = 0; i < 9; i++) later(.05 + i * .06, () => { if (!G) return; G.proj.push({ kind: 'shot', owner: f, img: 'whale', x: o.x + (rnd() - .5) * 900, y: GROUND - 1200 - rnd() * 200, vx: f.dir * .5, vy: 30 + rnd() * 12, g: 1, floorY: GROUND - 60,
        size: 180 + rnd() * 120, dmg: 0, light: true, noHit: 99999, spin: true, col: '#ffd23f', t: 0, s: 1, cine: 'fistrain', sp: true }); });   // 10/2 꼬마 고래빵 비 (연출만)
    },
    hit(f, d, p) { shockwave(d.x, GROUND - 260, 1.6, '#ffd000'); crumbs(d.x, GROUND - 300, 30); dust(d.x, 1, 14); dust(d.x, -1, 14); cam.shake = 46; overlay.white = .7; tw(overlay, { white: 0 }, .45, 'lin'); A.sfx('bigboom'); text('쾅!', { size: 300, life: 1, x: clamp(d.x, 320, W - 320), y: GROUND - 620, col: '#ffd23f', stroke: '#7a3a00', rot: .06 }); },
    land(f, p) { shockwave(p.x, GROUND - 60, 1.2, '#ffd000'); dust(p.x, 1, 12); dust(p.x, -1, 12); crumbs(p.x, GROUND - 120, 20); cam.shake = 36; A.sfx('bigboom'); p.vx = 0; p.dead = true; },
  },
  // ---------- 초딩 R2 "119 신고": 휴대폰 클로즈업 "여보세요, 119죠?" → 빨강·파랑 사이렌 빛(둥근 번짐)이 점점 → "119 신고 완료!" 도장 + 울산인 배지
  call119: {
    start() { cineMood(.2, .5, .3); },
    pre(f, sp, t) {
      const c = cutF(sp);
      if (t === c) { camTo(2.0, f.x + f.dir * 40, headY(f) + 200, .35); cineMood(.35, 1, .3); say(f, '여보세요, 119죠?', 1.5); }
      if (t > c) ex.siren = Math.min(1, (t - c) / 80);
      if (t >= c + 16 && (t - c - 16) % 26 === 0) A.sfx('siren', 1 + (t - c) / 30);   // 사이렌 점점 크게
      if (t === c + 78) camTo(1.1, W / 2, GROUND - 480, .3);
    },
    siren(f, d) {
      stamp('119 신고 완료!', { size: 150, y: 320, col: '#e0182d', rot: -.06, life: 1.9 });
      fx.push({ type: 'badge', x: f.x < W / 2 ? 330 : W - 330, y: 690, t0: RT + .25, rt: true, life: 1.7 });
      rlater(.3, () => A.sfx('sparkle'));
      shockwave(d.x, GROUND - 380, 1.2, '#ff5a6a'); cam.shake = 38;
    },
  },
  // ---------- 초딩 R3 "부표 스매시": 총알 시간 속에서 커다란 부표를 휘두름(카메라가 부표를 따라감·물방울) → 원래 속도로 쾅! 가장 큰 흔들림
  buoy: {
    start() { cineMood(.2, .5, .3); },
    pre(f, sp, t) {
      const c = cutF(sp);
      if (t === c) { slowMo(.22, 1.7); cineMood(.55, 1, .25); heartbeat(3, .5); A.sfx('slow'); sp.swing = 0; }
      if (t >= c && t <= c + 84) { sp.swing = EASE.io(Math.min(1, (t - c) / 80)); const b = buoyPos(f, sp.swing); camFollow(b.x - f.dir * 40, b.y + 90, 1.6, .16, .04 * f.dir * Math.sin(sp.swing * Math.PI)); if (t % 2 === 0) drops(b.x, b.y, 3, '#7fe8ff', 420); }
      if (t === c + 84) { slowSnap(); A.sfx('whoosh'); f.pose = sp.def.pose || f.pose; sp.swing = null; camTo(1.08, W / 2, GROUND - 470, .15); cineMood(.1, .6, .15); }
    },
    draw(f, sp) {
      if (sp.swing == null || sp.fired) return; const img = IMG.vfx_buoy; if (!img) return; const b = buoyPos(f, sp.swing), w = 380, h = w * img.height / img.width;
      ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(f.x - f.dir * 20, GROUND - 340, 250, f.dir > 0 ? b.a - .9 : Math.PI - b.a, f.dir > 0 ? b.a : Math.PI - b.a + .9); ctx.stroke(); ctx.restore();   // 휘두른 자국(둥근 호)
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a * f.dir + .6); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
    },
    hit(f, d, p) {
      rlater(.2, () => text('스매시!!', { size: 300, life: 1.3, y: 330, col: '#7fe8ff', stroke: '#06305a', rot: -.06 }));
      shockwave(d.x, p.y, 2.1, '#00f0ff'); fx.push({ type: 'ring', x: d.x, y: p.y, t0: T + .25, life: .9, r: 1300, col: '#ffffff', lw: 30 });
      drops(d.x, p.y, 44, '#7fe8ff', 1500); cam.shake = 66; overlay.white = .95; tw(overlay, { white: 0 }, .55, 'lin'); G.hitstop = 18; A.sfx('bigboom'); A.sfx('splash');
    },
    knock(f, d, dir) { d.vx = dir * 26; d.vy = -22; },
  },
  // ---------- 직장인 "월급 입금!": 알림 순간 짧은 슬로모션 + 휴대폰 클로즈업 → 마지막 발에 동전 비
  payday: {
    start() { cineMood(.15, .5, .3); },
    pre(f, sp, t) {
      const c = cutF(sp);
      if (t === c) { slowMo(.3, .75); camTo(1.7, f.x + f.dir * 280, headY(f) + 120, .3); cineMood(.35, 1, .2); A.sfx('slow'); }
      if (t === c + 34) { slowSnap(); camTo(1.2, f.x + f.dir * 120, GROUND - 430, .25); }
    },
    fire0(f, sp) {   // 10/2 더 화려하게: 화면 전체에 동전 비 + 금액 숫자가 톡톡
      coinRain(W / 2, 44); for (let i = 0; i < 6; i++) rlater(.08 * i, () => pop(['+3,280,000', '+₩₩₩', '+보너스', '+야근수당', '+성과급', '+월급'][i], 300 + rnd() * (W - 600), 260 + rnd() * 260, '#ffd23f', 64));
      fx.push({ type: 'ring', x: f.x, y: GROUND - 320, t0: T, life: .6, r: 700, col: '#ffd23f', lw: 26 }); },
    hit(f, d, p, fin) { if (!fin) return; coinRain(d.x, 60); shockwave(d.x, p.y, 1.8, '#ffd23f'); text('입금 완료!', { size: 140, life: 1.4, y: 300, col: '#ffd23f', stroke: '#16307a', rot: -.05 }); cam.shake = 34; },
  },
  // ---------- 산신령: 발사 순간 둥근 기운 + 마지막 한 방에 잠깐 슬로모션
  sage: {
    fire0(f) { shockwave(f.x + f.dir * 120, GROUND - 320, .8, f.sp.def.col); cam.shake = 22; },
    hit(f, d, p, fin) { if (!fin) return; slowMo(.3, .45); cineMood(.4, .6, .1); rlater(.5, () => cineMood(0, 0, .3)); shockwave(d.x, GROUND - 350, 1.3, f.sp ? f.sp.def.col : '#c9a6ff'); text('산신령의 힘!', { size: 140, life: 1.3, y: 300, col: '#19f5c8', stroke: '#3b1466', rot: -.05 }); cam.shake = 34; },
  },
};

function updateFighter(f) {
  const o = opp(f), inp = f.in, C = f.C, spd = C.speed;
  if (f.late) { inp.pressed[f.late] = true; f.late = null; }
  const fwd = f.dir > 0 ? inp.r : inp.l, back = f.dir > 0 ? inp.l : inp.r;
  const awayFromO = o.x > f.x ? inp.l : inp.r;
  f.holdBack = awayFromO; f.crouching = false;
  f.hist.push({ d: 5 + (fwd ? 1 : back ? -1 : 0) + (inp.u ? 3 : inp.d ? -3 : 0), p: !!inp.pressed.p, k: !!inp.pressed.k }); if (f.hist.length > 32) f.hist.shift();
  if (f.invul > 0 && f.invul < 999) f.invul--;
  if (f.hurtVoiceCd > 0) f.hurtVoiceCd--;
  f.st++;
  const canAct = G.phase === 'fight';
  switch (f.state) {
    case 'idle': case 'walk': case 'crouch': case 'guardwait': {
      if (!canAct) { f.vx = 0; break; }
      faceOpp(f);
      const pr = inp.pressed;
      const threat = o.state === 'attack' || o.state === 'special' || G.proj.some(p => p.owner === o);
      if (pr.s && f.meter >= 100 && grounded(f)) { startSpecial(f); break; }
      if (tryAttack(f, inp)) break;
      if (inp.u) { setState(f, 'jumpsquat', P(f).crouch); f.jumpDir = fwd ? 1 : back ? -1 : 0; f.sy = .86; f.vx = 0; break; }
      if (inp.d) { if (f.state !== 'crouch') setState(f, 'crouch'); f.crouching = true; f.vx = 0; f.pose = (awayFromO && threat) ? P(f).crouchGuard : P(f).crouch; break; }
      if (awayFromO && threat && Math.abs(o.x - f.x) < 700) { if (f.state !== 'guardwait') setState(f, 'guardwait'); f.vx = 0; f.pose = P(f).guard; break; }
      if (fwd) { if (f.state !== 'walk') setState(f, 'walk'); f.vx = spd.walk * f.dir; f.pose = P(f).walk; f.walkBack = false; }
      else if (back) { if (f.state !== 'walk') setState(f, 'walk'); f.vx = -spd.back * f.dir; f.pose = P(f).walk; f.walkBack = true; }
      else { if (f.state !== 'idle') setState(f, 'idle'); f.vx = 0; f.pose = P(f).idle; }
      if (f.state === 'walk' && f.st % 16 === 0) A.sfx('step');
      break;
    }
    case 'jumpsquat':
      if (f.st >= 3) { f.vy = -spd.jumpV; f.vx = f.jumpDir * spd.jumpX * f.dir; f.air = true; f.y -= 1; f.airAtk = -1; f.airHit = false;
        setState(f, 'jump', P(f).jump); f.sy = 1.12; f.sx = .9; tw(f, { sy: 1, sx: 1 }, .3); A.sfx('jump'); dust(f.x, f.dir, 5); }
      break;
    case 'jump':
      if (f.airAtk < 0 && (inp.pressed.p || inp.pressed.k) && canAct) { f.airAtk = 0; f.move = C.moves.jumpAttack; f.moveHit = false; f.pose = f.move.pose; A.sfx('whoosh'); if (f.move.voice && Math.random() < .5) A.voice(f.move.voice, .8); }
      if (f.airAtk >= 0) f.airAtk++;
      break;
    case 'land':
      if (canAct && tryAttack(f, inp)) break;          // 착지하자마자 펀치 → 점프 콤보
      if (f.st >= 5) setState(f, 'idle', P(f).idle);
      break;
    case 'attack': {
      const m = f.move, tot = m.startup + m.active + m.recovery;
      if (m.anim) { let p = m.anim[0][0]; for (const [ps, at] of m.anim) if (f.st >= at) p = ps; f.pose = p; }
      if (inp.pressed.p) f.buf = { b: 'p', t: f.st }; if (inp.pressed.k) f.buf = { b: 'k', t: f.st };
      if (f.st === m.startup) { f.ox = f.dir * 26; f.sx = 1.08; tw(f, { ox: 0, sx: 1 }, (m.active + m.recovery) / 60); if (m.shock) { fx.push({ type: 'shock', x: f.x + f.dir * 200, t0: T, life: .5 }); dust(f.x + f.dir * 200, f.dir, 10); cam.shake = Math.max(cam.shake, 14); } if (m.sfx === 'stomp') A.sfx('stomp'); }
      if (f.st >= m.startup && f.st < m.startup + m.active && f.st % 2 === 0) ghost(f);
      // 기술 전용 움직임
      if (m.dash) { if (f.st >= m.startup - 2 && f.st < m.startup + m.active) f.vx = m.dash * f.dir; else if (f.st === m.startup + m.active) f.vx = 0; }
      if (m.hop && f.st === 2) { f.vy = -m.hop.vy; f.vx = (m.hop.vx || 0) * f.dir; f.air = true; f.y -= 1; dust(f.x, f.dir, 4); }
      if (m.multi && f.st > m.startup && f.st < m.startup + m.active && (f.st - m.startup) % m.multi === 0) f.moveHit = false;
      if (f.st === m.startup) {
        if (m.proj) { const v = m.proj; G.proj.push({ kind: 'shot', light: true, owner: f, img: v.img, x: f.x + f.dir * 130, y: GROUND - (v.y || 300), vx: f.dir * (v.speed || 15), size: v.size || 240, dmg: v.dmg || 6, col: v.col || '#fff', spin: true, t: 0, s: .4 }); tw(G.proj[G.proj.length - 1], { s: 1 }, .15); }
        if (m.wave) { const v = m.wave; G.proj.push({ kind: 'wave', owner: f, x: f.x + f.dir * 150, y: GROUND, vx: f.dir * (v.speed || 12), dmg: v.dmg || 6, kd: !!v.kd, col: v.col || '#fff3d0', t: 0 }); }
        if (m.rings) for (let i = 0; i < 3; i++) fx.push({ type: 'ring', x: f.x + f.dir * (170 + i * 80), y: f.y - 340, t0: T + i * .07, life: .45, r: 150 + i * 50, col: i % 2 ? '#ffffff' : '#ff8ad0', lw: 16 });
        if (m.meter) { f.meter = Math.min(100, f.meter + m.meter); f.glow = 1; tw(f, { glow: 0 }, .6); A.sfx('sparkle'); }
        if (m.popStart) pop(m.popStart, f.x, headY(f) - 40, '#ffe600', 80);
      }
      // 연계: 맞았을 때 — 필살 캔슬 > 기술 캔슬 > 같은 버튼(chain) · 다른 버튼(links)
      if (f.moveHit && f.st >= m.startup && !f.air) {
        if (inp.pressed.s && f.meter >= 100) { banner(f, '필살 캔슬!'); startSpecial(f); break; }
        if (!m.cmd && (inp.pressed.p || inp.pressed.k)) { const c = cmdFor(f, inp.pressed.p ? 'p' : 'k'); if (c) { startMove(f, c.move, c.btn, true); break; } }
        const nx = f.buf && f.st - f.buf.t < 20 ? (f.buf.b === f.moveBtn ? m.chain : (m.links || {})[f.buf.b]) : null;
        if (nx) { startMove(f, nx, f.buf.b, true); break; }
      }
      if (f.C.rapid && inp.pressed.p && !f.moveHit && f.moveKey !== f.C.rapid.move && !f.air && pressCount(f, 'p', 24) >= 3) { startMove(f, f.C.rapid.move, 'p'); break; }
      if (f.st >= tot && !f.air) { setState(f, 'idle', P(f).idle); f.move = null; }
      break;
    }
    case 'hitstun': case 'blockstun':
      if (f.st >= f.stun) setState(f, 'idle', P(f).idle);
      break;
    case 'knockdown': case 'ko':
      f.rot += (f.state === 'ko' ? .05 : .03) * -f.dir * (f.air ? 1 : 0);
      break;
    case 'down':
      if (f.st >= 42) { setState(f, 'getup', P(f).crouch); f.rot = 0; f.invul = 16; f.sy = .85; tw(f, { sy: 1 }, .25, 'back'); }
      break;
    case 'getup':
      if (f.st >= 14) setState(f, 'idle', P(f).idle);
      break;
    case 'special': {
      const sp = f.sp; sp.t++;
      if (G.freeze > 0) break;
      const v = sp.def.vfx || {};
      if (!sp.fired) { sp.fired = true; sp.t = 0; endFreeze(f); }
      if (v.type === 'multi') { (v.shots || []).forEach((s, i) => { if (sp.t === s.delay + 1) { const last = i === v.shots.length - 1, pr = spawnProj(f, s.img ? Object.assign({}, v, s) : v, sp.def.dmg / v.shots.length, s.y); if (!last) pr.keep = true; else pr.fin = true; } }); }
      if (v.type === 'siren' && sp.sirenAt && sp.t === sp.sirenAt) sirenHit(f, sp.def);
      if (sp.def.anim && v.type !== 'gun') { let p = null; for (const [ps, at] of sp.def.anim) if (sp.t >= at) p = ps; if (p) f.pose = p; }
      if (v.type === 'gun') gunTick(f, v, sp);
      if (v.type === 'glasses' && sp.t === (v.at || 0)) spawnGlasses(f, v, sp.def.dmg);
      const cn = CINE[sp.def.cine]; if (cn && cn.tick) cn.tick(f, sp, sp.t);
      const endT = v.type === 'multi' ? (v.shots[v.shots.length - 1].delay + 26) : v.type === 'siren' ? (sp.sirenAt || 40) + 30 : v.type === 'gun' ? gunEnd(v) : v.type === 'glasses' ? (sp.caught ? sp.t : sp.hitAt ? Math.min(sp.hitAt + 26, 130) : 130) : (v.endT || 30);
      if (sp.t >= endT) { f.invul = 0; f.sp = null; setState(f, 'idle', P(f).idle); if (cn) cineEnd(); }
      break;
    }
  }
  // 물리
  if (f.air || f.y < GROUND) {
    f.vy += spd.gravity; f.y += f.vy; f.x += f.vx;
    if (f.y >= GROUND) { f.y = GROUND; f.vy = 0; f.air = false; landed(f); }
  } else {
    f.x += f.vx;
    if (f.state === 'hitstun' || f.state === 'blockstun' || f.state === 'down' || f.state === 'dead' || f.state === 'getup') { f.vx *= .82; if (Math.abs(f.vx) > 4 && T % .1 < DT) dust(f.x, -Math.sign(f.vx) || 1, 1); }
  }
  f.x = clamp(f.x, WALL_L, WALL_R);
  f.hpLag += (f.hp - f.hpLag) * .05;
  f.tint = Math.max(0, f.tint - .06);
}
function landed(f) {
  A.sfx('land');
  if (f.state === 'attack') { f.vx = 0; dust(f.x, f.dir, 6); f.sy = .9; tw(f, { sy: 1 }, .2, 'back'); }
  if (f.state === 'jump') { f.airAtk = -1; setState(f, 'land', P(f).land || P(f).crouch); f.vx = 0; f.sy = .86; tw(f, { sy: 1 }, .22, 'back'); dust(f.x, f.dir, 5); }
  else if (f.state === 'knockdown') { setState(f, 'down', P(f).down); f.rot = 0; f.vx *= .4; cam.shake = Math.max(cam.shake, 14); dust(f.x, f.dir, 12); f.sy = .9; tw(f, { sy: 1 }, .3, 'back'); A.sfx('stomp'); }
  else if (f.state === 'ko') { setState(f, 'dead', P(f).down); f.rot = 0; f.vx *= .3; cam.shake = 26; dust(f.x, f.dir, 16); A.sfx('stomp'); }
  else if (f.state === 'hitstun') { f.vx *= .5; }
}

// ---------- 판정 ----------
function hurtRect(f) {
  const b = f.C.body, low = f.crouching || f.state === 'crouch' || f.pose === P(f).crouch || f.state === 'getup';
  const h = f.state === 'down' || f.state === 'dead' ? b.crouchH * .45 : low ? b.crouchH : b.h;
  return { x0: f.x - b.hw, x1: f.x + b.hw, y0: f.y - h, y1: f.y };
}
function hitRect(f) {
  let m = null;
  if (f.state === 'attack' && f.move && !f.moveHit && f.st >= f.move.startup && f.st < f.move.startup + f.move.active) m = f.move;
  if (f.state === 'jump' && f.airAtk >= 0 && !f.moveHit && f.move && f.airAtk >= f.move.startup && f.airAtk < f.move.startup + f.move.active) m = f.move;
  if (!m || !m.hitbox) return null;
  const hb = m.hitbox, x0 = f.dir > 0 ? f.x + hb.x : f.x - hb.x - hb.w;
  return { x0, x1: x0 + hb.w, y0: f.y - hb.y - hb.h, y1: f.y - hb.y, m };
}
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
function canBlock(d, level, from) {
  if (d.air || d.y < GROUND) return false;
  if (!['idle', 'walk', 'crouch', 'guardwait', 'blockstun'].includes(d.state)) return false;
  const awayHeld = from.x > d.x ? d.in.l : d.in.r; if (!awayHeld) return false;
  const low = d.in.d;
  if (level === 'low' && !low) return false;
  if (level === 'high' && low) return false;
  return true;
}
function resolveHit(a, d, m, r) {
  if (G.phase !== 'fight') return;   // 9/30: 승패가 난 뒤(K.O.·TIME OVER)에는 더 맞지 않음 → 진 사람이 'YOU WIN'을 보는 일 없게
  const dirPush = d.x >= a.x ? 1 : -1;
  const hx = (Math.max(r.x0, d.x - d.C.body.hw) + Math.min(r.x1, d.x + d.C.body.hw)) / 2, hy = (Math.max(r.y0, hurtRect(d).y0) + r.y1) / 2;
  a.moveHit = true;
  if (canBlock(d, m.level, a)) {
    d.hp = Math.max(1, d.hp - 1); setState(d, 'blockstun', d.in.d ? P(d).crouchGuard : P(d).guard); d.stun = m.blockstun; d.vx = dirPush * m.push * .8;
    a.meter = Math.min(100, a.meter + 3); d.meter = Math.min(100, d.meter + 4);
    G.hitstop = 5; cam.shake = Math.max(cam.shake, 8); spark(hx, hy, .7, '#9fd8ff'); A.sfx('guard'); pop('GUARD', d.x, headY(d) - 60, '#9fd8ff', 50);
    if (d.x <= WALL_L + 5 || d.x >= WALL_R - 5) a.vx = -dirPush * m.push * .6;
    return;
  }
  const fromAir = a.state === 'jump';
  if (fromAir) a.jumpHitT = T;
  if (a.state === 'attack') a.moveHits++;
  const juggle = d.state === 'hitstun' || d.state === 'knockdown';
  if (juggle && combo.side === a.side && T - combo.last < 1.5) combo.n++; else { combo.side = a.side; combo.n = 1; }
  combo.last = T; combo.pop = 1; tw(combo, { pop: 0 }, .25);
  const scale = Math.max(.5, 1 - .1 * (combo.n - 1));
  const dmg = Math.max(1, Math.round(m.dmg * scale * a.dmgOut * d.dmgIn));
  d.hp = Math.max(0, d.hp - dmg);
  a.meter = Math.min(100, a.meter + 9 * (a.C.meterGain || 1)); d.meter = Math.min(100, d.meter + 5);
  d.tint = 1; const big = m.big || .8;
  G.hitstop = Math.round(6 + 4 * big); cam.shake = Math.max(cam.shake, 16 * big);
  spark(hx, hy, big, m.sparkCol || '#fff6c0'); A.sfx(m.sfx === 'boing' ? 'boing' : 'hit', big);
  if (m.popText) pop(m.popText, d.x, headY(d) - 40, '#ffd6f0', 80);
  if (d.hurtVoiceCd <= 0 && (m.kd || Math.random() < .35)) { A.voice(pick(d.C.voices.hurt || []), .85); d.hurtVoiceCd = 50; }
  if (a.state === 'attack' && !a.bannered) {           // 콤보 이름 띄우기
    const rp = a.C.rapid && a.moveKey === a.C.rapid.move;
    if (a.chainN >= 2) { banner(a, m.comboName || '삼단 콤보!'); a.bannered = true; }
    else if (m.cmd && a.chainN >= 1) { banner(a, '연계기! ' + m.cmd.name); a.bannered = true; }
    else if (a.fromJump) { banner(a, '점프 콤보!'); a.bannered = true; }
    else if (rp && a.moveHits >= 3) { banner(a, a.C.rapid.name + '!'); a.bannered = true; }
  }
  if (combo.side === a.side && combo.n === 5) banner(a, '대박 콤보!!');
  if (d.hp <= 0) { doKO(d, a, dirPush); return; }
  if (fromAir && !(m.kd || d.air || d.y < GROUND)) { setState(d, 'hitstun', d.in.d ? P(d).crouchHit : P(d).hit); d.stun = m.hitstun + 10; d.vx = dirPush * m.push * .6; return; }   // 점프 공격은 경직을 길게 → 착지 후 연결
  if (m.kd || d.air || d.y < GROUND) { setState(d, 'knockdown', P(d).hit); d.air = true; d.vy = -13; d.vx = dirPush * (m.push * .7 + 3); d.y = Math.min(d.y, GROUND - 1); }
  else { setState(d, 'hitstun', d.in.d ? P(d).crouchHit : P(d).hit); d.stun = m.hitstun; d.vx = dirPush * m.push; d.ox = dirPush * 8; tw(d, { ox: 0 }, .2); }
  if (d.x <= WALL_L + 5 || d.x >= WALL_R - 5) a.vx = -dirPush * m.push * .7;
}
function projHit(p, d) {
  if (G.phase !== 'fight') return;   // 9/30: 승패가 난 뒤(K.O.·TIME OVER)에는 더 맞지 않음 → 진 사람이 'YOU WIN'을 보는 일 없게
  const a = p.owner, dirPush = Math.sign(p.vx) || 1;
  if (canBlock(d, 'mid', a)) {
    if (p.sp) { d.hp = Math.max(0, d.hp - 8); if (d.hp <= 0) { doKO(d, a, dirPush); return true; } } else d.hp = Math.max(1, d.hp - 3); setState(d, 'blockstun', d.in.d ? P(d).crouchGuard : P(d).guard); d.stun = 22; d.vx = dirPush * 10;   // 10/2: 필살기는 막혀도 8 깎이고 마무리 가능
    G.hitstop = 6; cam.shake = Math.max(cam.shake, 14); spark(d.x - dirPush * 60, p.y, 1, '#9fd8ff'); A.sfx('guard'); pop('GUARD', d.x, headY(d) - 60, '#9fd8ff', 56);
    if (p.sp && slow.k < 1) { slowSnap(); cineMood(0, 0, .25); tw(cam, { zoom: 1, x: W / 2, y: H / 2, rot: 0 }, .28, 'out', true); }   // 막으면 슬로모션 끝
    return true;
  }
  const dmg = Math.round(p.dmg * a.dmgOut * d.dmgIn);
  if (combo.side === a.side && T - combo.last < 1.5 && (d.state === 'hitstun' || d.state === 'knockdown')) combo.n++; else { combo.side = a.side; combo.n = 1; } combo.last = T; combo.pop = 1; tw(combo, { pop: 0 }, .25);
  d.hp = Math.max(0, d.hp - dmg); d.tint = 1; a.meter = Math.min(100, a.meter + 4);
  const cn = p.sp && CINE[p.cine];
  if (p.keep && d.hp > 0) {   // 여러 발 필살기의 앞 발: 쓰러뜨리지 않고 붙잡아 둠 → 마지막 발까지 다 맞게
    spark(d.x - dirPush * 40, Math.min(p.y, GROUND - 160), 1.2, p.col); A.sfx('hit', 1.3); G.hitstop = 6; cam.shake = Math.max(cam.shake, 18);
    if (d.air || d.y < GROUND) { setState(d, 'knockdown', P(d).hit); d.air = true; d.vy = -9; d.vx = dirPush * 4; }
    else { setState(d, 'hitstun', P(d).hit); d.stun = 46; d.vx = dirPush * 4; }
    if (cn && cn.hit) cn.hit(a, d, p, false);
    return true;
  }
  superHit(d.x - dirPush * 40, Math.min(p.y, GROUND - 200), p.col); A.sfx('hit', 2); A.sfx('ko');
  G.hitstop = 10; cam.shake = 30;
  if (d.hurtVoiceCd <= 0) { A.voice(pick(d.C.voices.hurt || []), 1); d.hurtVoiceCd = 50; }
  if (cn && cn.hit) cn.hit(a, d, p, true);
  if (d.hp <= 0) { doKO(d, a, dirPush); return true; }
  setState(d, 'knockdown', P(d).hit); d.air = true; d.vy = -15; d.vx = dirPush * 12; d.y = Math.min(d.y, GROUND - 1);
  if (cn && cn.knock) cn.knock(a, d, dirPush);
  return true;
}
function lightHit(p, d, level) { // 기술용 작은 발사체 · 땅 충격파
  if (G.phase !== 'fight') return;   // 9/30: 승패가 난 뒤(K.O.·TIME OVER)에는 더 맞지 않음 → 진 사람이 'YOU WIN'을 보는 일 없게
  const a = p.owner, dirPush = Math.sign(p.vx) || 1;
  if (canBlock(d, level, a)) {
    d.hp = Math.max(1, d.hp - 1); setState(d, 'blockstun', d.in.d ? P(d).crouchGuard : P(d).guard); d.stun = 14; d.vx = dirPush * 7;
    G.hitstop = 4; cam.shake = Math.max(cam.shake, 8); spark(d.x - dirPush * 50, Math.min(p.y, GROUND - 120), .6, '#9fd8ff'); A.sfx('guard'); pop('GUARD', d.x, headY(d) - 60, '#9fd8ff', 50); a.meter = Math.min(100, a.meter + 2);
    return;
  }
  if (combo.side === a.side && T - combo.last < 1.5 && (d.state === 'hitstun' || d.state === 'knockdown')) combo.n++; else { combo.side = a.side; combo.n = 1; } combo.last = T; combo.pop = 1; tw(combo, { pop: 0 }, .25);
  const dmg = Math.max(1, Math.round(p.dmg * a.dmgOut * d.dmgIn)); d.hp = Math.max(0, d.hp - dmg); d.tint = 1;
  a.meter = Math.min(100, a.meter + 6 * (a.C.meterGain || 1)); d.meter = Math.min(100, d.meter + 4);
  spark(d.x - dirPush * 40, Math.min(p.y, GROUND - 120), 1, p.col); A.sfx('hit', 1); G.hitstop = 7; cam.shake = Math.max(cam.shake, 14);
  if (d.hurtVoiceCd <= 0 && Math.random() < .4) { A.voice(pick(d.C.voices.hurt || []), .85); d.hurtVoiceCd = 50; }
  if (d.hp <= 0) { doKO(d, a, dirPush); return; }
  if (p.kd || d.air || d.y < GROUND) { setState(d, 'knockdown', P(d).hit); d.air = true; d.vy = -12; d.vx = dirPush * 8; d.y = Math.min(d.y, GROUND - 1); }
  else { setState(d, 'hitstun', d.in.d ? P(d).crouchHit : P(d).hit); d.stun = 22; d.vx = dirPush * 9; }
}
function whirlHit(p, d) {
  if (G.phase !== 'fight') return;   // 9/30: 승패가 난 뒤(K.O.·TIME OVER)에는 더 맞지 않음 → 진 사람이 'YOU WIN'을 보는 일 없게
  const a = p.owner, dirPush = Math.sign(p.vx) || 1, blocked = canBlock(d, 'mid', a);
  p.hitsLeft--; p.cd = 9; const last = p.hitsLeft <= 0;
  if (blocked) { d.hp = Math.max(1, d.hp - 1); setState(d, 'blockstun', P(d).guard); d.stun = 14; d.vx = dirPush * 6; spark(d.x, GROUND - 300, .6, '#9fd8ff'); A.sfx('guard'); G.hitstop = 3; return; }
  const dmg = Math.round(p.dmg / p.hits * a.dmgOut * d.dmgIn);
  d.hp = Math.max(0, d.hp - dmg); d.tint = 1; spark(d.x, GROUND - 200 - rnd() * 300, .9, p.col); A.sfx('hit', 1.1); G.hitstop = 4; cam.shake = 14;
  if (combo.side === a.side && T - combo.last < 1.5) combo.n++; else { combo.side = a.side; combo.n = 1; } combo.last = T; combo.pop = 1; tw(combo, { pop: 0 }, .25);
  if (d.hp <= 0) { doKO(d, a, dirPush); p.hitsLeft = 0; return; }
  if (last) { superHit(d.x, GROUND - 350, p.col); setState(d, 'knockdown', P(d).hit); d.air = true; d.vy = -16; d.vx = dirPush * 10; d.y = GROUND - 1; A.voice(pick(d.C.voices.hurt || [])); const cn = CINE[p.cine]; if (cn && cn.hit) cn.hit(a, d, p, true); }
  else { setState(d, 'hitstun', P(d).hit); d.stun = 16; d.vx = p.vx * .9; d.y = Math.min(d.y, GROUND); }
}
function sirenHit(f, sp) {
  if (G.phase !== 'fight') return;   // 9/30: 승패가 난 뒤(K.O.·TIME OVER)에는 더 맞지 않음 → 진 사람이 'YOU WIN'을 보는 일 없게
  const d = opp(f), v = sp.vfx;
  ex.siren = 1; A.sfx('siren'); tw(ex, { siren: 0 }, 1.6, 'in');
  const cn = CINE[sp.cine];
  if (cn && cn.siren) cn.siren(f, d); else text(v.text || '신고 완료!', { size: 150, life: 1.8, y: 330, rot: -.04, col: '#ff5a5a', stroke: '#0d2a6b' });
  A.voice(v.voice);
  if (d.invul > 0 || d.state === 'dead') return;
  const dmg = Math.round(sp.dmg * f.dmgOut * d.dmgIn); d.hp = Math.max(0, d.hp - dmg); d.tint = 1;
  combo.side = f.side; combo.n = 1; combo.last = T;
  superHit(d.x, GROUND - 380, v.hitColor || '#ff8080'); G.hitstop = 10; cam.shake = 30; A.sfx('ko');
  const dirPush = d.x >= f.x ? 1 : -1;
  if (d.hp <= 0) { doKO(d, f, dirPush); return; }
  setState(d, 'knockdown', P(d).hit); d.air = true; d.vy = -15; d.vx = dirPush * 10; d.y = GROUND - 1; A.voice(pick(d.C.voices.hurt || []));
  if (cn && cn.knock) cn.knock(f, d, dirPush);
}
function doKO(d, a, dirPush) {
  if (G.phase !== 'fight') return;
  G.phase = 'ko'; G.pt = 0; G.winner = a; G.loser = d; slow.k = slow.to = 1; slow.left = 0; tw(cine, { desat: 0, bars: 0 }, .4, 'out', true);
  setState(d, 'ko', P(d).ko); d.air = true; d.vy = -17; d.vx = dirPush * 11; d.y = Math.min(d.y, GROUND - 1);
  A.voice(d.C.voices.ko || pick(d.C.voices.hurt || []));
  A.sfx('ko'); A.bgmStop(); knockout(d);
}

function every(p, key, n, k) { p[key] = (p[key] || 0) + k; if (p[key] >= n) { p[key] -= n; return true; } return false; }   // k 만큼씩 쌓아서 n 마다 한 번
function projUpdate(k = 1) {   // k = 슬로모션 속도 (1 = 보통). 발사체는 매 화면 k 만큼 부드럽게 움직임
  for (const p of G.proj) {
    p.t += k;
    const d = opp(p.owner);
    if (p.kind === 'shot') {
      p.x += p.vx * k;
      if (p.vy != null && !p.boomerang) { p.y += p.vy * k; p.vy += (p.g || 0) * k; if (p.floorY && p.y > p.floorY) { p.y = p.floorY; p.vy = 0; p.g = 0; if (!p.landed) { p.landed = true; const cn = p.sp && CINE[p.cine]; if (cn && cn.land) cn.land(p.owner, p); } } }
      const R = p.size * .22, hr = hurtRect(d);
      if (!p.dead && (p.hitLeft ?? 1) > 0 && p.t >= (p.noHit || 0) && d.invul <= 0 && !['dead', 'ko', 'down'].includes(d.state) && p.x + R > hr.x0 && p.x - R < hr.x1 && p.y + R * .6 > hr.y0 && p.y - R * .6 < hr.y1) {
        if (p.hitLeft != null) { p.keep = p.hitLeft > 1; p.fin = !p.keep; }
        if (p.light) lightHit(p, d, 'mid'); else projHit(p, d);
        if (p.img === 'bullet' && !p.light) { dust(d.x, -Math.sign(p.vx), 10); for (let j = 0; j < 5; j++) fx.push({ type: 'streak', x: d.x - Math.sign(p.vx) * 60, y: p.y + (rnd() - .5) * 260, dir: Math.sign(p.vx), t0: T + j * .03, life: .25, len: 200 + rnd() * 160 }); }
        if (p.boomerang) { p.hitLeft--; if (p.hitLeft > 0) { p.noHit = p.t + 25; p.range = Math.abs(p.x - p.x0) + 380; } else { p.ret = true; p.vy = -6; } }
        else p.dead = true; }
      if (p.boomerang) {   // 안경: 목표 높이로 살짝 떠오르고, 맞히거나 멀리 가면 주인 얼굴로 되돌아옴
        if (!p.ret) { p.y += (p.ty - p.y) * .08 * k; if (Math.abs(p.x - p.x0) > p.range || p.x < WALL_L - 60 || p.x > WALL_R + 60) { p.ret = true; p.retAt = p.t; } }
        else { const o = p.owner, tx = o.x + o.dir * 40, ty = headY(o) + 70, dx = tx - p.x, dy = ty - p.y, dd = Math.hypot(dx, dy) || 1, sp2 = Math.min(44, Math.abs(p.vx) * 1.05 + 1);
          p.vx = dx / dd * sp2; p.y += (dy / dd * sp2 * .9 + (p.vy || 0)) * k; p.vy = (p.vy || 0) * Math.pow(.9, k);
          if (dd < 50 && (p.hitLeft <= 0 || p.t - (p.retAt || 0) > 30)) { p.dead = true; if (o.sp && o.sp.def.vfx && o.sp.def.vfx.type === 'glasses') o.sp.caught = true; A.sfx('catch'); pop('착!', o.x, headY(o) - 40, '#fff', 60); fx.push({ type: 'ring', x: tx, y: ty, t0: T, life: .3, r: 110, col: '#ffe9f5', lw: 10 }); } }
        if (every(p, '_d', 2, k)) { const a = rnd() * Math.PI * 2; fx.push({ type: 'dot', x: p.x + Math.cos(a) * p.size * .3, y: p.y + Math.sin(a) * p.size * .2, vx: -p.vx * 4, vy: -60 - rnd() * 80, t0: T, life: .45, r: 5 + rnd() * 7, col: pick(['#fff', '#ffe600', '#ff7ac0', '#9ff5ff']) }); }
        if (every(p, '_r', 6, k)) fx.push({ type: 'ring', x: p.x, y: p.y, t0: T, life: .3, r: p.size * .45, col: p.ret ? '#ffe9f5' : p.col, lw: 6 });
      } else if (every(p, '_t', 3, k)) fx.push({ type: 'trail', x: p.x, y: p.y, r: R * .8, col: p.col, t0: T, life: .25 });
      if (p.slowShot && slow.k < 1 && every(p, '_w', 5, 1)) fx.push({ type: 'ring', x: p.x, y: p.y, t0: T, life: .5, r: p.size * .9, col: 'rgba(255,255,255,.7)', lw: 5 });   // 총알 시간: 공기 물결(둥근 고리)
      if (!p.boomerang && (p.x < -300 || p.x > W + 300)) p.dead = true;
      if (p.t > 400) p.dead = true;
    } else if (p.kind === 'wave') {
      p.x += p.vx * k; const hr = hurtRect(d);
      if (!p.dead && d.invul <= 0 && !['dead', 'ko', 'down'].includes(d.state) && hr.y1 >= GROUND - 20 && Math.abs(d.x - p.x) < 80 + d.C.body.hw) { lightHit(p, d, 'low'); p.dead = true; }
      if (every(p, '_d', 5, k)) dust(p.x, -Math.sign(p.vx), 2);
      if (p.t > 80 || p.x < WALL_L - 100 || p.x > WALL_R + 100) p.dead = true;
    } else if (p.kind === 'whirl') {
      p.x += p.vx * k; if (p.cd > 0) p.cd -= k;
      const hr = hurtRect(d);
      if (p.hitsLeft > 0 && p.cd <= 0 && d.invul <= 0 && !['dead', 'ko', 'down'].includes(d.state) && Math.abs(d.x - p.x) < 150 + d.C.body.hw && hr.y1 > GROUND - 700) whirlHit(p, d);
      if (every(p, '_d', 4, k)) dust(p.x, -Math.sign(p.vx), 2);
      if (p.hitsLeft <= 0 || p.x < WALL_L - 100 || p.x > WALL_R + 100 || p.t > 150) { if (!p.fading) { p.fading = true; p.fadeT = p.t; tw(p, { on: 0 }, .35); } }
      if (p.fading && p.t - p.fadeT > 22) p.dead = true;
    }
  }
  if (G.proj.some(p => p.dead)) G.proj = G.proj.filter(p => !p.dead);
}
function pushApart(a, b) {
  const min = a.C.body.hw + b.C.body.hw + 10, dx = b.x - a.x;
  const vOverlap = !(a.y < b.y - b.C.body.h * .75 || b.y < a.y - a.C.body.h * .75);
  if (!vOverlap || Math.abs(dx) >= min) return;
  if (['dead', 'ko'].includes(a.state) || ['dead', 'ko'].includes(b.state)) return;
  const s = dx === 0 ? (a.side === 0 ? 1 : -1) : Math.sign(dx), over = (min - Math.abs(dx)) / 2;
  a.x -= s * over; b.x += s * over;
  if (a.x < WALL_L) { b.x += WALL_L - a.x; a.x = WALL_L; } if (b.x > WALL_R) { a.x -= b.x - WALL_R; b.x = WALL_R; }
  if (b.x < WALL_L) { a.x += WALL_L - b.x; b.x = WALL_L; } if (a.x > WALL_R) { b.x -= a.x - WALL_R; a.x = WALL_R; }
}

// =====================================================================
//  CPU (난이도 1 쉬움 · 2 보통 · 3 어려움)
// =====================================================================
const AI_CMD = { 1: 0, 2: .2, 3: .32 };   // CPU가 기술(커맨드)을 쓰는 확률 — 1판(쉬움)은 안 씀
const AIP = {
  1: { react: 22, block: .25, lowRead: .35, antiAir: .15, sup: .4, jumpIn: .04, aggr: .5, chain: .35, dmgOut: .85, dmgIn: 1.05, walkIn: .9 },
  2: { react: 14, block: .45, lowRead: .6, antiAir: .4, sup: .7, jumpIn: .07, aggr: .65, chain: .7, dmgOut: 1, dmgIn: 1, walkIn: 1 },
  3: { react: 8, block: .65, lowRead: .85, antiAir: .7, sup: 1, jumpIn: .1, aggr: .8, chain: 1, dmgOut: 1.15, dmgIn: .9, walkIn: 1.1 },
};
function makeAI(level) { const o = { level, P: AIP[level], cd: 20, hold: {}, out: { pressed: {} }, chainTry: false }; for (const b of ['l', 'r', 'u', 'd', 'p', 'k', 's', 'start']) { o.out[b] = false; o.out.pressed[b] = false; } return o; }
function aiStep(f) {
  const ai = f.ai, P_ = ai.P, o = opp(f), out = ai.out;
  for (const b in out.pressed) out.pressed[b] = false;
  const press = b => { out.pressed[b] = true; };
  const dist = Math.abs(o.x - f.x), toward = o.x > f.x ? 'r' : 'l', away = toward === 'r' ? 'l' : 'r';
  const reach = f.C.moves.punch.hitbox.x + f.C.moves.punch.hitbox.w + o.C.body.hw - 10;
  const kreach = f.C.moves.kick.hitbox.x + f.C.moves.kick.hitbox.w + o.C.body.hw - 10;
  if (G.phase !== 'fight') { out.l = out.r = out.u = out.d = false; return out; }
  // 콤보 이어가기 (같은 버튼 chain · 다른 버튼 links)
  if (f.moveKey !== ai.lastMove || f.state !== 'attack') { ai.chainTry = false; ai.lastMove = f.state === 'attack' ? f.moveKey : ''; }
  if (f.state === 'attack' && f.moveHit && f.move && (f.move.chain || f.move.links) && !ai.chainTry) { ai.chainTry = true;
    if (Math.random() < P_.chain) { const ls = Object.keys(f.move.links || {}); press(ls.length && (!f.move.chain || Math.random() < .45) ? pick(ls) : f.moveBtn); } }
  const cmdP = AI_CMD[ai.level] || 0, cmds = f.C.commands || [];
  const doCmd = c => { out.l = out.r = out.u = out.d = false; if (c.easy === 'f' || c.easy === 'df') out[toward] = true; if (c.easy === 'b') out[away] = true; if (c.easy === 'df') out.d = true; press(c.btn); ai.cd = Math.round(P_.react * (.8 + Math.random() * .6)); return out; };
  // 점프 중 공격
  if (f.state === 'jump' && f.airAtk < 0 && dist < 330 && f.vy > -8 && Math.random() < .5) press('k');
  if (ai.cd > 0) { ai.cd--; return out; }
  out.l = out.r = out.u = out.d = false;
  if (!['idle', 'walk', 'crouch', 'guardwait', 'land'].includes(f.state)) { ai.cd = 2; return out; }
  const oAtk = (o.state === 'attack' && o.move && o.move.hitbox && o.st < o.move.startup + o.move.active && dist < (o.move.hitbox.x + o.move.hitbox.w + f.C.body.hw + 90)) || (o.state === 'jump' && dist < 420);
  const projIn = G.proj.find(p => p.owner === o && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 650);
  const r = Math.random();
  if ((oAtk || projIn || o.state === 'special') && r < P_.block + (projIn ? (projIn.sp ? -.1 : .15) : (o.state === 'special' ? -.1 : 0))) {
    out[away] = true; if (oAtk && o.move && o.move.level === 'low' && Math.random() < P_.lowRead) out.d = true;
    ai.cd = 14 + (P_.react >> 1); return out;
  }
  if (o.state === 'jump' && dist < 430 && Math.random() < P_.antiAir) {
    const aa = cmdP && cmds.find(c => f.C.moves[c.move].antiAir); if (aa && Math.random() < .5) return doCmd(aa);
    out.d = true; press('p'); ai.cd = P_.react; return out; }
  if (cmdP && dist > kreach && dist < 1300 && Math.random() < cmdP * .12 && !G.proj.some(p => p.owner === f)) {   // 멀리서: 발사체 · 충격파
    const far = cmds.filter(c => { const m = f.C.moves[c.move]; return m.proj || m.wave; }); if (far.length) return doCmd(pick(far)); }
  if (f.meter >= 100 && Math.random() < P_.sup * .25 && dist < 1100) { press('s'); ai.cd = P_.react; return out; }
  if (dist > kreach) {
    if (Math.random() < P_.jumpIn && dist < 650 && dist > 300) { out.u = true; out[toward] = true; ai.cd = 8; return out; }
    if (Math.random() < P_.walkIn) out[toward] = true;
    ai.cd = Math.round(P_.react * (.4 + Math.random() * .6)); return out;
  }
  if (Math.random() < P_.aggr) {
    if (cmdP && Math.random() < cmdP) { const near = cmds.filter(c => { const m = f.C.moves[c.move]; return (m.hitbox && !m.antiAir) || (m.meter && f.meter < 60 && dist > 500); }); if (near.length) return doCmd(pick(near)); }
    const c = Math.random();
    if (dist > reach) { press('k'); if (Math.random() < .3) out.d = true; }
    else if (c < .5) press('p'); else if (c < .78) press('k'); else { out.d = true; press('k'); }
    ai.cd = Math.round(P_.react * (.6 + Math.random() * .8)); return out;
  }
  if (Math.random() < .5) out[away] = true;
  ai.cd = Math.round(P_.react * (.5 + Math.random())); return out;
}

// =====================================================================
//  대전 진행
// =====================================================================
function startMatch(opt) { // opt: { mode: 'arcade'|'versus'|'demo', stage, p1, p2, ai: [lvl|null, lvl|null] }
  resetFx();
  const f0 = newFighter(opt.p1, 0, 600), f1 = newFighter(opt.p2, 1, 1320);
  if (opt.p1 === opt.p2) f1.hue = 160;
  G = { mode: opt.mode, stage: opt.stage, opt, f: [f0, f1], proj: [], phase: 'intro', pt: 0, timer: SET.timer * 60, hitstop: 0, freeze: 0, winner: null, loser: null, introEvents: [], introT: 0 };
  [f0, f1].forEach((f, i) => {
    const lvl = opt.ai[i];
    if (lvl) { f.ai = makeAI(lvl); f.in = f.ai.out; f.dmgOut = AIP[lvl].dmgOut; f.dmgIn = (opt.mode === 'arcade' ? AIP[lvl].dmgIn : 1) * (f.C.def || 1); }
    f.label = opt.mode === 'demo' ? 'CPU' : lvl ? 'CPU' : (i === 0 ? '1P' : '2P');
    setState(f, 'intro', P(f).intro);
  });
  if (opt.mode === 'demo') { f0.dmgOut = f1.dmgOut = 1; f0.dmgIn = f0.C.def || 1; f1.dmgIn = f1.C.def || 1; }
  const st = STAGES[G.stage];
  // 등장 순서
  const ev = G.introEvents; let t = .3;
  ev.push({ t: .05, fn: () => { A.sfx('sparkle'); f0.sy = .9; f1.sy = .9; tw(f0, { sy: 1 }, .4, 'back'); tw(f1, { sy: 1 }, .4, 'back'); } });
  for (const f of [f1, f0]) { let l = (f.C.introLines || [])[G.stage];
    // 10/2: 마지막 판 산신령이 지금 1등을 부름 ("○○○의 기록 0:46.30… 깰 수 있겠느냐?")
    if (f.C.boss && G.mode === 'arcade' && G.stage === STAGES.length - 1) { const top = rankLoad()[0]; if (top && top.name) l = { text: `${String(top.name).slice(0, 8)}의 기록 ${fmtTime(top.time)}… 깰 수 있겠느냐?`, voice: null }; }
    if (l) { const tt = t; ev.push({ t: tt, skip: true, fn: () => { say(f, l.text, 1.7); A.voice(l.voice); } }); t += 1.9; } }
  const tr = Math.max(t, 1.0); G.roundAt = tr;
  ev.push({ t: tr, fn: () => { for (const f of G.f) { setState(f, 'idle', P(f).idle); } text(G.mode === 'versus' ? st.place : st.round, { size: 170, life: 1.3, col: '#ffffff', stroke: G.stage === 2 ? '#5a1a1a' : '#15306b' }); tw(hud, { show: 1 }, .5); A.voice(G.mode === 'versus' ? 'a_round1' : st.announce); } });
  ev.push({ t: tr + 1.15, fn: () => { fx.push({ type: 'fightcut', t0: T, life: 1.2 }); A.sfx('cutin'); cam.shake = 12; A.voice('a_fight'); } });
  ev.push({ t: tr + 1.45, fn: () => { G.phase = 'fight'; A.bgm('fight'); } });   // 배경음악 고르기에서 고른 곡이 그대로 (곡 바꾸지 않음)
  A.bgm(null); A.bgmStop();
}
function updateMatch() {
  IN_assign();
  if (G.mode === 'arcade' && G.phase === 'fight' && RUN) RUN.time += DT;   // 순위용: 싸우는 시간만 합산
  if (G.hitstop > 0 || G.freeze > 0) for (const f of G.f) for (const b of ['p', 'k', 's']) if (f.in.pressed[b]) f.late = b;   // 멈칫하는 동안 누른 버튼도 기억 → 콤보가 끊기지 않게
  if (G.hitstop > 0) { G.hitstop--; cam.shake *= .9; return; }
  RT += DT; stepSlow(); T += DT * slow.k; runQueue(); stepTweens();
  const [a, b] = G.f;
  if (G.phase === 'intro') {
    G.introT += DT;
    const human = G.f.some(f => !f.ai && f.in.any) || (G.mode !== 'demo' && IN.anyPressed && G.f.some(f => !f.ai));
    if (human && G.introT > .5 && G.introT < G.roundAt - .05) { G.introT = G.roundAt - .01; for (const e of G.introEvents) if (e.skip) e.done = true; fx = fx.filter(f => f.type !== 'bubble'); }
    for (const e of G.introEvents) if (!e.done && G.introT >= e.t) { e.done = true; e.fn(); }
  }
  if (G.freeze > 0) {
    G.freeze--; const f = G.freezeBy; f.st++; if (f.sp) { f.sp.t++; specialPre(f); }
    if (G.freeze === 0) { f.st = 0; }
  } else {
    // 슬로모션이면 k 만큼만 진행 (k = .2 → 5화면에 한 번). 날아가는 것(발사체)은 매 화면 k 만큼 부드럽게
    G.slowAcc = (G.slowAcc || 0) + slow.k; let n = 0;
    while (G.slowAcc >= .999 && n < 2 && G.hitstop <= 0 && G.freeze <= 0) { G.slowAcc -= 1; n++;
      for (const f of G.f) if (f.ai) aiStep(f);
      updateFighter(a); updateFighter(b);
      if (G.phase === 'fight' || G.phase === 'ko') {
        const ra = hitRect(a), rb = hitRect(b);
        const ha = ra && b.invul <= 0 && !['dead', 'ko', 'down'].includes(b.state) && overlap(ra, hurtRect(b));
        const hb = rb && a.invul <= 0 && !['dead', 'ko', 'down'].includes(a.state) && overlap(rb, hurtRect(a));
        if (ha) resolveHit(a, b, ra.m, ra); if (hb && G.phase === 'fight') resolveHit(b, a, rb.m, rb);
      }
      pushApart(a, b);
      // 제한 시간: 필살기 연출·슬로모션 동안은 멈춤 (불공평하지 않게)
      if (G.phase === 'fight' && slow.k >= .999 && !G.f.some(f => f.state === 'special')) { G.timer--; if (G.timer <= 0) timeOver(); }
    }
    if (G.freeze <= 0 && (G.phase === 'fight' || G.phase === 'ko')) projUpdate(slow.k);
  }
  for (const f of G.f) if (f.sp && f.sp.fired) { const cn = CINE[f.sp.def.cine]; if (cn && cn.frame) cn.frame(f, f.sp); }   // 필살기 연출: 매 화면 (카메라 따라가기 등)
  if (G.phase === 'ko') {
    G.pt++;
    if (G.pt === 100) { const w = G.winner; if (w && w.state !== 'dead') { setState(w, 'win', P(w).win); A.voice(w.C.voices.win); w.sy = .9; tw(w, { sy: 1 }, .4, 'back'); } resultText(); }
    if (G.pt === 100 + 200) finishMatch();
  }
  if (T - combo.last > 1.6) combo.shown = Math.max(0, combo.shown - DT * 4); else combo.shown = 1;
  cam.shake *= .88;
  if (fx.length > 500) fx.splice(0, fx.length - 500);
  fx = fx.filter(fxAlive);
}
function IN_assign() { // 사람 입력 연결 (1인 모드는 두 벌 입력 합쳐서 1P)
  for (const f of G.f) if (!f.ai) f.in = G.mode === 'arcade' ? IN.merged() : IN.p[f.side];
}
function timeOver() {
  G.phase = 'ko'; G.pt = 0; const [a, b] = G.f;
  text('TIME OVER', { size: 200, life: 1.8, col: '#ffe600', stroke: '#7b2cff', font: NUM }); A.bgmStop();
  if (Math.abs(a.hp - b.hp) < .5) { G.winner = null; G.loser = null; for (const f of G.f) setState(f, 'lose', P(f).lose); }
  else { G.winner = a.hp > b.hp ? a : b; G.loser = opp(G.winner); setState(G.loser, 'lose', P(G.loser).lose); A.voice(G.loser.C.voices.lose); }
  for (const f of G.f) { f.vx = 0; }
  G.pt = 40;
}
function resultText() {
  const w = G.winner;
  if (!w) { text('DRAW', { size: 220, life: 2.4, col: '#ffffff', stroke: '#15306b', font: NUM }); return; }
  if (w.hp >= 100) later(.9, () => { text('PERFECT!', { size: 150, life: 1.6, y: 700, col: '#19f5c8', stroke: '#1a0830', font: NUM }); A.voice('a_perfect'); });
  let s, col = '#ffd23f';
  if (G.mode === 'arcade') { s = w.ai ? 'YOU LOSE' : (isFinalStage(G.stage) ? 'YOU WIN' : 'ROUND WIN'); if (w.ai) col = '#ff5a6a'; }
  else if (G.mode === 'versus') s = w.side === 0 ? '1P WIN' : '2P WIN';
  else s = `${w.C.name} 승리!`;
  text(s, { size: 170, life: 2.8, col, font: G.mode === 'demo' ? FONT : NUM }); if (!(G.mode === 'arcade' && w.ai)) A.voice('a_win');   // 졌을 때는 'You win' 목소리 안 나오게
  console.info('[결과]', G.mode, 'stage', G.stage, s, 'winnerSide', w.side, 'ai', !!w.ai, 'hp', G.f[0].hp, G.f[1].hp, 'states', G.f[0].state, G.f[1].state);
}
function finishMatch() {
  const w = G.winner, o = G.opt;
  if (G.mode === 'demo') return go('ranking', { from: 'attract' });   // 데모 → 순위표 → 타이틀 (전시 반복)
  if (G.mode === 'versus') return go('continue', { match: o, win: w ? w.side : -1 });   // 다시 붙기 / 캐릭터 다시 / 처음으로
  if (!w) return go('vs', { match: o });                               // 무승부 → 같은 판 다시 (만화 다시 안 나옴)
  if (w.ai) return go('continue', { match: o });                       // 졌을 때 → 다시하기 / 캐릭터 다시 / 처음으로
  const nx = nextStage(o.stage);
  if (nx == null) { if (storyOn()) return go('comic', { src: STORY_CLIPS.end, after: () => afterEnding(o.p1) }); return go('ending', { p1: o.p1 }); }   // 마지막 판 이김 → (스토리: 엔딩 만화 →) 엔딩/순위표
  return toVs(Object.assign({}, o, { stage: nx, ai: [null, aiFor(nx)] }));   // 다음 판 (스토리: 그 산 만화 먼저)
}

// =====================================================================
//  그리기: 캐릭터 · 효과 · 무대
// =====================================================================
function drawFighter(o, alpha = 1, pose = o.pose, x = o.x + o.ox, y = o.y, rot = o.rot, dir = o.dir, sx = o.sx, sy = o.sy, isGhost = false) {
  const spr = SPR[o.key + '/' + pose]; if (!spr) return;
  let bob = 0, lean = 0, breath = 1;
  if (!isGhost) {
    if (o.state === 'idle' || o.state === 'guardwait' || o.state === 'win' || o.state === 'intro') { bob = Math.sin(T * 5 + o.side * 1.3) * 5; breath = 1 + Math.sin(T * 5 + o.side * 1.3) * .012; }
    if (o.state === 'win') bob = -Math.abs(Math.sin(T * 6)) * 18;
    if (o.state === 'walk') { bob = -Math.abs(Math.sin(T * 10)) * 12; lean = (o.walkBack ? -.05 : .05) * dir; }
    if (o.state === 'hitstun') x += Math.sin(T * 90) * 6 * Math.max(0, 1 - o.st / 10);
    if (o.state === 'attack' && o.move && o.st < o.move.startup) lean = -.05 * dir;
  }
  const flip = dir * o.C.facing * (spr.flip ? -1 : 1);
  ctx.save(); ctx.globalAlpha = alpha;
  const st = G ? STAGES[G.stage] : null; let filt = st && st.filter !== 'none' ? st.filter : '';
  if (o.hue) filt += ` hue-rotate(${o.hue}deg)`; if (filt) ctx.filter = filt;
  ctx.translate(x, y + bob); ctx.rotate((rot || 0) + lean); ctx.scale(sx * flip, sy * breath);
  if (o.glow > 0 && alpha === 1) { ctx.shadowColor = o.C.col[0]; ctx.shadowBlur = 60 * o.glow; }
  ctx.drawImage(spr.cv, -spr.ax, -spr.ay, spr.w, spr.h);
  if (o.tint > 0 && alpha === 1) { ctx.shadowBlur = 0; ctx.filter = 'none'; ctx.globalAlpha = o.tint * .6; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(spr.cv, -spr.ax, -spr.ay, spr.w, spr.h); }
  if (o.invul > 0 && o.invul < 999 && o.state === 'getup' && Math.floor(T * 20) % 2) { ctx.globalAlpha = .25; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(spr.cv, -spr.ax, -spr.ay, spr.w, spr.h); }
  ctx.restore();
  if (DEBUG && !isGhost) { ctx.save(); ctx.strokeStyle = '#0f0'; ctx.lineWidth = 3; const r = hurtRect(o); ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    const h = hitRect(o); if (h) { ctx.strokeStyle = '#f00'; ctx.lineWidth = 5; ctx.strokeRect(h.x0, h.y0, h.x1 - h.x0, h.y1 - h.y0); }
    ctx.fillStyle = spr.auto ? '#f0f' : '#ff0'; ctx.fillRect(o.x - 6, o.y - 6, 12, 12); ctx.font = '22px monospace'; ctx.fillText(`${pose} ${o.state}`, o.x - 80, o.y + 40); ctx.restore(); }
}
function drawStar(x, y, r, col) { ctx.save(); ctx.translate(x, y); ctx.fillStyle = col; ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const q = i % 2 ? r * .45 : r, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
function shadow(o) {
  const lift = Math.max(0, GROUND - o.y), w = o.C.body.hw * 2;
  ctx.save(); ctx.fillStyle = 'rgba(40,20,0,.35)'; ctx.beginPath(); ctx.ellipse(o.x, GROUND - 8, Math.max(40, w - lift * .3), 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function drawBurst() { // 필살기·K.O. 배경: 대각선 색 번짐 + 둥근 망점 + 떠다니는 빛 조각 (방사형 광선 없음)
  if (ex.burst <= 0) return; const [c1, c2] = ex.burstCol;
  ctx.save(); ctx.globalAlpha = ex.burst;
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.globalAlpha = ex.burst * .25; ctx.fillStyle = '#fff';
  for (let y = 0; y < H; y += 36) for (let x = (y / 36 % 2) * 18; x < W; x += 36) { const r = 3 + 5 * (x / W); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  for (let i = 0; i < 22; i++) { const p = ((T * .55 + i * .173) % 1), sx = ((i * 263) % (W + 600)) - 100 + p * -700, sy = -120 + p * (H + 300);
    ctx.globalAlpha = ex.burst * Math.min(1, (1 - p) * 2); ctx.lineWidth = 5; ctx.lineCap = 'round';
    const tg = ctx.createLinearGradient(sx, sy, sx + 220, sy - 290); tg.addColorStop(0, 'rgba(255,255,255,.9)'); tg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.strokeStyle = tg;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 220, sy - 290); ctx.stroke(); drawStar(sx, sy, 20 + (i % 3) * 8, i % 2 ? '#fff6b0' : '#ffffff'); }
  ctx.restore();
}
function drawStageFx(layer) {
  const S = STAGES[G ? G.stage : 0];
  if (layer === 'back') {
    if (S.floorDark) { const g = ctx.createLinearGradient(0, 780, 0, H); g.addColorStop(0, 'rgba(5,8,25,0)'); g.addColorStop(.25, `rgba(5,8,25,${S.floorDark})`); g.addColorStop(1, `rgba(5,8,25,${S.floorDark + .15})`); ctx.fillStyle = g; ctx.fillRect(-40, 780, W + 80, H); }
    if (S.fire) { const f = S.fire, fl = .8 + Math.sin(T * 13) * .1 + Math.sin(T * 7.3) * .08;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, 520 * fl);
      g.addColorStop(0, 'rgba(255,170,60,.55)'); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = g; ctx.fillRect(f.x - 600, f.y - 600, 1200, 1200); ctx.restore();
      for (let i = 0; i < 14; i++) { const p = ((T * .6 + i * .137) % 1), x = f.x + Math.sin(i * 12.9 + T * 2) * 40 * p, y = f.y - p * 300;
        ctx.fillStyle = `rgba(255,${180 - p * 100},60,${1 - p})`; ctx.beginPath(); ctx.arc(x, y, 4 * (1 - p) + 1, 0, 7); ctx.fill(); } }
    if (S.mist) { ctx.save(); for (let i = 0; i < 5; i++) { const x = ((T * (18 + i * 6) + i * 520) % (W + 800)) - 400;
      ctx.globalAlpha = .18; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, 700 + i * 30, 380, 40, 0, 0, 7); ctx.fill(); } ctx.restore(); }
    if (ex.sun > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const sx = 860, sy = 400 - ex.sun * 110;
      const g = ctx.createRadialGradient(sx, sy, 10, sx, sy, 900); g.addColorStop(0, `rgba(255,230,160,${.9 * ex.sun})`); g.addColorStop(.15, `rgba(255,180,90,${.5 * ex.sun})`); g.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80); ctx.fillStyle = `rgba(255,250,225,${ex.sun})`; ctx.beginPath(); ctx.arc(sx, sy, 60, 0, 7); ctx.fill(); ctx.restore(); }
  } else if (S.fire) { const f = S.fire; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(f.x, f.y + 100, 10, f.x, f.y + 100, 700);
    g.addColorStop(0, `rgba(255,140,50,${.14 + Math.sin(T * 11) * .03})`); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = g; ctx.fillRect(f.x - 800, f.y - 700, 1600, 1500); ctx.restore(); }
}
function drawCloud(x, y, s, al, dir) {
  ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.scale(s * dir, s);
  const puffs = [[-150, 20, 80], [-70, -40, 100], [40, -55, 110], [140, -10, 90], [190, 50, 70], [60, 55, 95], [-60, 60, 85]];
  for (let i = 1; i < 6; i++) { ctx.globalAlpha = al * (.25 - i * .04); ctx.fillStyle = '#bfefff'; ctx.beginPath(); ctx.ellipse(-120 * i - 60, 10, 90 - i * 10, 45 - i * 5, 0, 0, 7); ctx.fill(); }
  ctx.globalAlpha = al; ctx.lineWidth = 16; ctx.strokeStyle = '#0b2a5a'; for (const [px, py, r] of puffs) { ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.stroke(); }
  for (const [px, py, r] of puffs) { const g = ctx.createRadialGradient(px - r * .3, py - r * .4, r * .1, px, py, r); g.addColorStop(0, '#ffffff'); g.addColorStop(.7, '#e6f7ff'); g.addColorStop(1, '#8fd4ff'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(80,160,230,.7)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; const rot = T * 2;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(20 + k * 50, 5, 30 + k * 12, rot + k, rot + k + 2.4); ctx.stroke(); }
  ctx.restore();
}
function drawPetal(x, y, r, rot, col) {   // 10/2 벚꽃 꽃잎 하나 (끝이 살짝 갈라진 물방울)
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(0, -r); ctx.bezierCurveTo(r * .9, -r * .7, r * .8, r * .6, 0, r); ctx.bezierCurveTo(-r * .8, r * .6, -r * .9, -r * .7, 0, -r); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-r * .15, -r * .2, r * .22, r * .45, 0, 0, 7); ctx.fill(); ctx.restore();
}
function drawWhirl(p) {
  if (p.on > 0 && p.petal) {   // 10/2 학생 "센치멘탈": 벚꽃잎 회오리 + 음표 + 분홍 빛 (산신령 억새 회오리와 다르게)
    ctx.save(); ctx.globalAlpha = p.on;
    const g = ctx.createRadialGradient(p.x, GROUND - 330, 20, p.x, GROUND - 330, 360); g.addColorStop(0, 'rgba(255,190,220,.45)'); g.addColorStop(1, 'rgba(255,190,220,0)');
    ctx.fillStyle = g; ctx.fillRect(p.x - 380, GROUND - 720, 760, 720);
    for (let i = 0; i < 70; i++) { const h = i / 70, a = T * 6 + i * 2.4, r = 70 + h * 200, y = GROUND - 30 - h * 680 + Math.sin(T * 3 + i) * 12, x = p.x + Math.cos(a) * r, front = Math.sin(a) > 0;
      drawPetal(x, y, front ? 15 : 10, a * 1.7 + i, front ? (i % 3 ? '#ffc2dc' : '#ff8fc0') : 'rgba(255,200,225,.55)'); }
    ctx.font = `64px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < 6; k++) { const a = T * 2.2 + k * 1.05, x = p.x + Math.cos(a) * 230, y = GROUND - 220 - k * 80 + Math.sin(T * 4 + k) * 20;
      ctx.lineWidth = 6; ctx.strokeStyle = '#2a1440'; ctx.strokeText(k % 2 ? '♪' : '♫', x, y); ctx.fillStyle = k % 2 ? '#ffffff' : '#ffd6e8'; ctx.fillText(k % 2 ? '♪' : '♫', x, y); }
    ctx.restore(); return;
  }
  if (p.on <= 0) return; ctx.save(); ctx.globalAlpha = p.on; ctx.lineCap = 'round';
  for (let i = 0; i < 80; i++) { const h = i / 80, a = T * 9 + i * 2.4, r = 60 + h * 190, y = GROUND - 30 - h * 700, x = p.x + Math.cos(a) * r, front = Math.sin(a) > 0;
    ctx.strokeStyle = front ? 'rgba(255,248,225,.95)' : 'rgba(210,190,150,.6)'; ctx.lineWidth = front ? 5 : 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 1) * 40, y - 30, x + Math.cos(a + 1.6) * 70, y - 10); ctx.stroke(); }
  ctx.restore();
}
// ---------- 직장인 필살기: 휴대폰 입금 알림 (위에서 내려오는 알림 창 · 진동) ----------
function drawNotify(f, t, a) {
  const inP = EASE.back(Math.min(1, t / .25)), outP = a > .85 ? (a - .85) / .15 : 0, w = 860, h = 170, x = W / 2 - w / 2 + (t < .45 ? Math.sin(t * 90) * 10 : 0), y = -h - 20 + (h + 210) * inP - outP * (h + 250);   // 체력바 아래(y≈190)에 멈춤
  ctx.globalAlpha = 1 - outP; ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
  ctx.fillStyle = 'rgba(250,250,252,.97)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 40); ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const cx = x + 95, cy = y + h / 2;   // 둥근 동전 아이콘
  ctx.fillStyle = '#f2a900'; ctx.beginPath(); ctx.arc(cx, cy, 56, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(cx, cy, 44, 0, 7); ctx.fill();
  ctx.strokeStyle = '#f2a900'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.ellipse(cx - 16, cy - 20, 12, 7, -.6, 0, 7); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#6b6f7a'; ctx.font = `36px ${FONT}`; ctx.fillText(f.title + ' · 지금', x + 180, y + 52);
  ctx.fillStyle = '#16181f'; ctx.font = `60px ${FONT}`; const bw = ctx.measureText(f.body).width, fs = bw > w - 210 ? Math.floor(60 * (w - 210) / bw) : 60; ctx.font = `${fs}px ${FONT}`; ctx.fillText(f.body, x + 180, y + 112);   // 긴 알림은 글자를 줄여 상자 안에
  const r = 18 + 40 * EASE.out(Math.min(1, t / .6));   // 둥근 반짝임 (광선 없음)
  if (t < .6) { ctx.globalAlpha = (1 - t / .6) * (1 - outP); ctx.strokeStyle = f.col; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(cx, cy, 56 + r, 0, 7); ctx.stroke(); }
}
function drawProj(p) {
  if (p.kind === 'whirl') return drawWhirl(p);
  if (p.kind === 'wave') { ctx.save(); for (let i = 0; i < 3; i++) { const r = 50 + i * 34 + (p.t * 3 % 34); ctx.globalAlpha = .9 - i * .25; ctx.strokeStyle = i % 2 ? '#fff3d0' : p.col; ctx.lineWidth = 12 - i * 3;
      ctx.beginPath(); ctx.ellipse(p.x, GROUND - 8, r * 1.7, r * .34, 0, 0, 7); ctx.stroke(); } ctx.restore(); return; }
  const dir = Math.sign(p.vx) || 1;
  if (p.img === 'glasses') return drawGlasses(p);
  if (p.img === 'bullet') return drawBullet(p);
  if (p.coins && rnd() < .45) fx.push({ type: 'dot', x: p.x - dir * p.size * p.s * .3, y: p.y + (rnd() - .5) * p.size * .4, vx: -dir * (60 + rnd() * 120), vy: -150 - rnd() * 150, t0: T, life: .5 + rnd() * .3, r: 9 + rnd() * 9, col: rnd() < .7 ? '#ffd23f' : '#9be07a' });   // 직장인: 동전·지폐 부스러기
  if (p.img === 'cloud') return drawCloud(p.x, p.y, p.s * p.size / 520, 1, dir);
  if (p.img === 'sound') { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(dir * p.s, p.s); ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const r = p.size * (.18 + i * .1) + (T * 400 % 40); ctx.globalAlpha = 1 - i * .2; ctx.lineWidth = 26 - i * 4; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(-p.size * .3, 0, r, -.9, .9); ctx.stroke(); ctx.lineWidth = 16 - i * 3; ctx.strokeStyle = i % 2 ? '#ffe600' : '#ff2f8a'; ctx.stroke(); }
    ctx.restore(); return; }
  const img = IMG['vfx_' + p.img]; const dw = p.size * p.s;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const R = dw * .45, gl = ctx.createRadialGradient(p.x, p.y, R * .2, p.x, p.y, R);
  gl.addColorStop(0, 'rgba(255,255,255,.45)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill(); ctx.restore();
  if (!img) { ctx.save(); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, dw * .25, 0, 7); ctx.fill(); ctx.restore(); return; }
  const dh = dw * img.height / img.width;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 1; i < 5; i++) { ctx.globalAlpha = (1 - i / 5) * .3; ctx.save(); ctx.translate(p.rotDown ? p.x : p.x - dir * i * 70 * p.s, p.rotDown ? p.y - i * 70 * p.s : p.y); ctx.scale(dir, 1); if (p.rotDown) ctx.rotate(Math.PI / 2); ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore(); } ctx.restore();
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(dir, 1); ctx.rotate(p.rotDown ? Math.PI / 2 + Math.sin(T * 20) * .06 : p.spin ? T * 6 : Math.sin(T * 12) * .05); if (p.img === 'fire') ctx.scale(1 + Math.sin(T * 14) * .06, 1); ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore();
}
function drawFx(layer) {
  for (const f of fx) {
    const t = fxAge(f); if (t < 0) continue; const a = t / f.life;
    ctx.save();
    if (layer === 'world') {
      if (f.type === 'ghost') drawFighter(f.who, .35 * (1 - a), f.pose, f.x, f.y, f.rot, f.dir, f.sx, f.sy, true);
      else if (f.type === 'dust') { ctx.globalAlpha = .55 * (1 - a); ctx.fillStyle = '#e8d5a8'; ctx.beginPath(); ctx.arc(f.x + f.vx * t, f.y + f.vy * t + 200 * t * t, f.r * (1 + a), 0, 7); ctx.fill(); }
      else if (f.type === 'shock') { ctx.globalAlpha = 1 - a; ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 12 * (1 - a); ctx.beginPath(); ctx.ellipse(f.x, GROUND - 5, 60 + a * 500, 14 + a * 40, 0, 0, 7); ctx.stroke(); }
      else if (f.type === 'trail') { ctx.globalAlpha = .35 * (1 - a); ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - a * .5), 0, 7); ctx.fill(); }
      else if (f.type === 'puff') { ctx.globalAlpha = .5 * (1 - a); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(f.x + f.vx * t, f.y - 110 * t, f.r * (1 + a * 1.6), 0, 7); ctx.fill(); }
      else if (f.type === 'boom' && IMG.vfx_boom) { const img = IMG.vfx_boom, sc = .5 + EASE.out(Math.min(1, a * 2.5)) * 1.3, dw = 900 * sc, dh = dw * img.height / img.width;
        ctx.globalAlpha = a < .6 ? 1 : (1 - a) / .4; ctx.translate(f.x, f.y); ctx.rotate(a * .4); ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); }
    }
    if (layer === 'hits') {
      if (f.type === 'ring') { ctx.globalAlpha = 1 - a; ctx.strokeStyle = f.col; ctx.lineWidth = (f.lw || 22) * (1 - a); ctx.beginPath(); ctx.arc(f.x, f.y, f.r * EASE.out(a), 0, 7); ctx.stroke(); }
      else if (f.type === 'flash') { ctx.globalAlpha = (1 - a) * .95; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - a * .5), 0, 7); ctx.fill(); }
      else if (f.type === 'muzzle') { const r = f.r * (.7 + .5 * EASE.out(a)); ctx.globalAlpha = 1 - a;   // 둥근 총구 불꽃 (광선 없음)
        ctx.fillStyle = '#ff9a1f'; ctx.beginPath(); ctx.ellipse(f.x + f.dir * r * .5, f.y, r * 1.25, r * .85, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.ellipse(f.x + f.dir * r * .45, f.y, r * .9, r * .6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x + f.dir * r * .35, f.y, r * .4, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 8 * (1 - a); ctx.beginPath(); ctx.arc(f.x + f.dir * r * .4, f.y, r * 1.6 * EASE.out(a) + 10, 0, 7); ctx.stroke(); }
      else if (f.type === 'streak') { ctx.globalAlpha = .85 * (1 - a); ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineWidth = 7 * (1 - a) + 2; const x0 = f.x - f.dir * a * 80;   // 가로 속도선
        ctx.beginPath(); ctx.moveTo(x0, f.y); ctx.lineTo(x0 - f.dir * f.len * (1 - a * .5), f.y); ctx.stroke(); }
      else if (f.type === 'dot') { ctx.globalAlpha = 1 - a; ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x + f.vx * t, f.y + f.vy * t + 900 * t * t, f.r * (1 - a * .6), 0, 7); ctx.fill(); }
      else if (f.type === 'paper') drawPaper(f, t, a);
      else if (f.type === 'coin') { const y = Math.min(GROUND - 16, f.y + f.vy * t + 1300 * t * t), sx = Math.abs(Math.cos(t * 9 + f.ph)) * .85 + .15;   // 둥근 동전 (빙글 돌며 떨어짐)
        ctx.globalAlpha = a > .8 ? (1 - a) / .2 : 1; ctx.translate(f.x, y); ctx.scale(sx, 1); ctx.fillStyle = '#b87a00'; ctx.beginPath(); ctx.arc(0, 0, f.r, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, 0, f.r * .8, 0, 7); ctx.fill();
        ctx.strokeStyle = '#e8a600'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, f.r * .5, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.ellipse(-f.r * .3, -f.r * .35, f.r * .22, f.r * .12, -.6, 0, 7); ctx.fill(); }
    }
    if (layer === 'bubble' && f.type === 'bubble') {
      const o = f.who, left = o.x < W / 2, inT = Math.min(1, t / .15), sc = .6 + .4 * EASE.back(inT), outA = a > .85 ? (1 - a) / .15 : 1;
      const bx = clamp(left ? o.x + 290 : o.x - 290, 330, W - 330), by = headY(o) + 90;
      ctx.globalAlpha = outA; ctx.translate(bx, by); ctx.scale(sc, sc);
      ctx.font = `62px ${FONT}`; const w = ctx.measureText(f.str).width + 84, h = 108, r = 44, L = -w / 2, R = w / 2, top = -h, bot = 0;
      const tx = left ? L + 70 : R - 70, tip = left ? tx - 46 : tx + 46;
      if (f.str === '여긴 내 산인데?') { ctx.globalAlpha0 = outA; emberPops(t, w, h); }   // 말풍선 뒤에서 튀어나옴
      ctx.beginPath(); ctx.moveTo(L + r, top); ctx.lineTo(R - r, top); ctx.arcTo(R, top, R, top + r, r); ctx.lineTo(R, bot - r); ctx.arcTo(R, bot, R - r, bot, r);
      if (left) { ctx.lineTo(tx + 20, bot); ctx.lineTo(tip, bot + 42); ctx.lineTo(tx - 16, bot); } else { ctx.lineTo(tx + 16, bot); ctx.lineTo(tip, bot + 42); ctx.lineTo(tx - 20, bot); }
      ctx.lineTo(L + r, bot); ctx.arcTo(L, bot, L, bot - r, r); ctx.lineTo(L, top + r); ctx.arcTo(L, top, L + r, top, r); ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 16; ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#111'; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(f.str, 0, top + h / 2 + 4);
    }
    if (layer === 'screen') {
      if (f.type === 'notify') drawNotify(f, t, a);
      if (f.type === 'stamp') drawStamp(f, t, a);
      if (f.type === 'badge') drawBadge(f, t, a);
      if (f.type === 'pop') { ctx.globalAlpha = 1 - a * a; ctx.font = `${f.size * 1.15}px ${FONT}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
        ctx.lineWidth = 6; ctx.strokeStyle = '#000'; const py = f.y - t * 90; ctx.strokeText(f.str, f.x, py); ctx.fillStyle = f.col; ctx.fillText(f.str, f.x, py); }
      if (f.type === 'banner') { const left = f.side === 0, inT = EASE.back(Math.min(1, t / .18)), outA = a > .8 ? (1 - a) / .2 : 1;
        ctx.font = `64px ${FONT}`; const w = ctx.measureText(f.str).width + 90, h = 100, x0 = left ? 40 - (1 - inT) * (w + 60) : W - 40 - w + (1 - inT) * (w + 60), y0 = 470;
        ctx.globalAlpha = outA; sticker(() => slantPanel(x0, y0, w, h, 30, !left), THEME[f.side][2], 9); label(f.str, x0 + w / 2 + (left ? -8 : 8), y0 + h / 2 + 3, 64, THEME[f.side][0], FONT, 'center', 9); }
      if (f.type === 'text') { if (!f.cv) f.cv = renderText(f);
        const inT = Math.min(1, t / .16), outA = a > .8 ? (1 - a) / .2 : 1, sc = inT < 1 ? 2.4 - 1.4 * EASE.back(inT) : 1 + (a > .8 ? (a - .8) * .5 : 0);
        ctx.globalAlpha = outA; ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(sc, sc); ctx.drawImage(f.cv, -f.cv.width / 2, -f.cv.height / 2); }
    }
    ctx.restore();
  }
}

// ---------- 필살기 연출 그림: 도장 · 종이 · 배지 (모두 둥근 모양, 광선 없음) ----------
function drawStamp(f, t, a) {
  const inT = Math.min(1, t / .12), sc = inT < 1 ? 2.8 - 1.8 * EASE.in(inT) : 1 + Math.max(0, .08 - (t - .12) * .6), outA = a > .8 ? (1 - a) / .2 : 1;
  ctx.globalAlpha = outA * (inT < 1 ? .5 + .5 * inT : 1); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(sc, sc);
  ctx.font = `${f.size}px ${FONT}`; const tw0 = ctx.measureText(f.str).width, subS = f.size * .36;
  const w = tw0 + f.size * .8, h = f.size * 1.2 + (f.sub ? subS * 1.3 : 0), r = f.size * .2;
  if (inT >= 1) { const k = Math.min(1, (t - .12) * 9); ctx.fillStyle = f.col; for (const d of f.dots) { ctx.globalAlpha = outA * .85; ctx.beginPath(); ctx.arc(d.x * w * 1.05, d.y * h * 1.2, d.r * k, 0, 7); ctx.fill(); } }
  ctx.globalAlpha = outA * .94; ctx.fillStyle = 'rgba(255,248,236,.92)'; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.fill();
  ctx.lineWidth = f.size * .11; ctx.strokeStyle = f.col; ctx.stroke();
  ctx.lineWidth = f.size * .03; ctx.beginPath(); ctx.roundRect(-w / 2 + f.size * .12, -h / 2 + f.size * .12, w - f.size * .24, h - f.size * .24, r * .6); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = f.col; ctx.lineJoin = 'round'; ctx.lineWidth = f.size * .05; ctx.strokeStyle = 'rgba(90,0,10,.9)';
  const ty = f.sub ? -subS * .62 : f.size * .04; ctx.strokeText(f.str, 0, ty); ctx.fillText(f.str, 0, ty);
  if (f.sub) { ctx.font = `${subS}px ${FONT}`; ctx.fillText(f.sub, 0, h / 2 - subS * .95); }
  ctx.fillStyle = 'rgba(255,248,236,.55)'; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(((i * 37) % 100 / 100 - .5) * w * .9, ((i * 61) % 100 / 100 - .5) * h * .8, 3 + (i % 3) * 3, 0, 7); ctx.fill(); }   // 도장 긁힘
}
function drawPaper(f, t, a) {   // 원고 종이 한 장 (흰 종이 + 줄 + 빨간 첨삭)
  let x, y; const o = f.orbit;
  if (o) { const ang = o.a0 + o.va * t; x = o.cx + Math.cos(ang) * o.r; y = o.cy + o.dy * .3 + Math.sin(ang) * o.r * .32 - o.rise * t; }
  else { x = f.x + f.vx * t; y = f.y + f.vy * t + 520 * t * t; }
  const w = f.w, h = w * 1.3, fl = Math.cos(t * 7 + f.ph);
  ctx.globalAlpha = a > .75 ? (1 - a) / .25 : 1; ctx.translate(x, y); ctx.rotate(f.rot + f.vr * t); ctx.scale(Math.max(.15, Math.abs(fl)), 1);
  ctx.fillStyle = fl > 0 ? '#ffffff' : '#eee8dc'; ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#9aa0b0'; ctx.lineWidth = 2; for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-w * .36, -h / 2 + i * h / 5.5); ctx.lineTo(w * .36, -h / 2 + i * h / 5.5); ctx.stroke(); }
  ctx.strokeStyle = '#e0182d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w * .18, h * .22, w * .13, 0, 7); ctx.stroke();
}
function drawBadge(f, t, a) {   // 울산인 배지: 금색 동그라미 + 별 + 글자, 쾅 떨어짐
  const inT = Math.min(1, t / .16), sc = inT < 1 ? 2.2 - 1.2 * EASE.back(inT) : 1, outA = a > .8 ? (1 - a) / .2 : 1, R = 150;
  ctx.globalAlpha = outA; ctx.translate(f.x, f.y); ctx.rotate(-.12 + Math.sin(t * 3) * .03); ctx.scale(sc, sc);
  ctx.fillStyle = '#7a4a00'; ctx.beginPath(); ctx.arc(0, 6, R, 0, 7); ctx.fill();
  const g = ctx.createRadialGradient(-R * .3, -R * .35, R * .1, 0, 0, R); g.addColorStop(0, '#fff3b0'); g.addColorStop(.55, '#ffd23f'); g.addColorStop(1, '#e09a00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill(); ctx.lineWidth = 10; ctx.strokeStyle = '#1a2a8a'; ctx.stroke();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, R * .8, 0, 7); ctx.stroke();
  drawStar(0, -R * .35, 34, '#ff5a6a');
  label('울산인', 0, R * .12, 62, '#1a2a8a', FONT, 'center', 0); label('용감한 신고', 0, R * .52, 30, '#7a1a00', FONT, 'center', 0);
}

// ---------- HUD (index.html 인터페이스 v2) ----------
const THEME = [['#ffe600', '#ff9d00', '#7b2cff'], ['#19f5c8', '#00b3ff', '#ff2f8a']];
function slant(x, y, w, h, k, flip) { ctx.beginPath();
  if (!flip) { ctx.moveTo(x + k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x, y + h); }
  else { ctx.moveTo(x, y); ctx.lineTo(x + w - k, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + k, y + h); } ctx.closePath(); }
function sticker(pathFn, fill, lw = 10) { ctx.save(); pathFn(); ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = '#000'; ctx.stroke(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore(); }
function hpBar(x, y, w, h, val, lag, flip, low, side) {
  const k = 22, [c1, c2, frame] = THEME[side];
  sticker(() => slant(x - 12, y - 12, w + 24, h + 24, k + 6, flip), frame);
  ctx.save(); slant(x, y, w, h, k, flip); ctx.fillStyle = '#1a0830'; ctx.fill(); ctx.clip();
  const wl = w * lag / 100, wv = w * val / 100;
  ctx.fillStyle = '#ff3b3b'; ctx.fillRect(flip ? x + w - wl : x, y, wl, h);
  const blink = low && Math.sin(T * 14) > 0, g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#ffffff'); g.addColorStop(.3, blink ? '#ff8a7a' : c1); g.addColorStop(1, blink ? '#c21d12' : c2);
  ctx.fillStyle = g; ctx.fillRect(flip ? x + w - wv : x, y, wv, h);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 10; i++) ctx.fillRect(x + w * i / 10, y, 3, h);
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(x, y + 4, w, 6); ctx.restore();
}
function namePlate(x, y, str, flip, side, tag) {
  const [c1, , frame] = THEME[side]; ctx.save(); ctx.font = `40px ${FONT}`; const w = ctx.measureText(str).width + 60, px = flip ? x - w : x;
  sticker(() => slant(px, y, w, 56, 16, flip), frame);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#000';
  ctx.strokeText(str, px + w / 2, y + 30); ctx.fillStyle = c1; ctx.fillText(str, px + w / 2, y + 30);
  if (tag) { ctx.font = `700 34px ${NUM}`; ctx.textAlign = flip ? 'right' : 'left'; const tx = flip ? px - 16 : px + w + 16; ctx.strokeText(tag, tx, y + 30); ctx.fillStyle = '#fff'; ctx.fillText(tag, tx, y + 30); }
  ctx.restore();
}
function supBar(x, y, w, val, flip, side) {
  const h = 22, k = 12, full = val >= 100, [c1, c2, frame] = THEME[side];
  sticker(() => slant(x - 8, y - 8, w + 16, h + 16, k + 4, flip), full ? (Math.sin(T * 12) > 0 ? frame : '#ffffff') : frame);
  ctx.save(); slant(x, y, w, h, k, flip); ctx.fillStyle = '#1a0830'; ctx.fill(); ctx.clip();
  const wv = w * val / 100, g = ctx.createLinearGradient(flip ? x + w : x, 0, flip ? x : x + w, 0);
  g.addColorStop(0, c2); g.addColorStop(1, c1); ctx.fillStyle = full ? `hsl(${(T * 360) % 360},100%,60%)` : g; ctx.fillRect(flip ? x + w - wv : x, y, wv, h); ctx.restore();
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = flip ? 'left' : 'right'; ctx.font = `700 ${full ? 44 : 34}px ${NUM}`;
  ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; const lx = flip ? x + w + 22 : x - 22;
  ctx.strokeText(full ? 'SUPER MAX' : 'SUPER', lx, y + h / 2 + 1); ctx.fillStyle = full ? c1 : '#fff'; ctx.fillText(full ? 'SUPER MAX' : 'SUPER', lx, y + h / 2 + 1); ctx.restore();
}
function portrait(x, y, f) {
  const s = 170, [c1, , frame] = THEME[f.side], img = IMG[f.C.face], pc = f.C.portrait || {};
  sticker(() => { ctx.beginPath(); ctx.roundRect(x, y, s, s, 22); }, frame);
  ctx.save(); ctx.beginPath(); ctx.roundRect(x + 8, y + 8, s - 16, s - 16, 16); ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + s); g.addColorStop(0, c1); g.addColorStop(1, frame); ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
  if (img) { if (f.hue) ctx.filter = `hue-rotate(${f.hue}deg)`; const cw = pc.size || img.width, sx = pc.sx || 0, sy = pc.sy || 0; ctx.drawImage(img, sx, sy, cw, cw, x + 4, y + 4 + (f.tint > 0 ? Math.sin(T * 60) * 4 : 0), s - 8, s - 8); ctx.filter = 'none'; }
  if (f.tint > 0) { ctx.globalAlpha = f.tint * .5; ctx.fillStyle = '#ff2f2f'; ctx.fillRect(x, y, s, s); }
  ctx.restore(); ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, s, s, 22); ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
}
function drawHud() {
  if (hud.show <= 0 || !G) return; const [a, b] = G.f;
  ctx.save(); ctx.globalAlpha = hud.show;
  const bw = 600, bh = 34, y = 70;
  portrait(56, 52, a); portrait(W - 56 - 170, 52, b);
  hpBar(252, y, bw, bh, a.hp, a.hpLag, false, a.hp < 30, 0); hpBar(W - 252 - bw, y, bw, bh, b.hp, b.hpLag, true, b.hp < 30, 1);
  namePlate(242, y + bh + 20, a.C.name, false, 0, a.label); namePlate(W - 242, y + bh + 20, b.C.name, true, 1, b.label);
  ctx.save(); ctx.translate(W / 2, y + 4); ctx.font = `700 96px ${NUM}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const secs = Math.ceil(G.timer / 60); ctx.lineWidth = 7; ctx.strokeStyle = '#000'; const ts = String(Math.max(0, secs)).padStart(2, '0'); ctx.strokeText(ts, 0, 22);
  ctx.fillStyle = secs <= 10 && Math.sin(T * 10) > 0 ? '#ff4040' : '#ffe600'; ctx.fillText(ts, 0, 22); ctx.restore();
  const S = STAGES[G.stage]; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#000';
  ctx.font = `700 27px ${NUM}`; ctx.letterSpacing = '4px'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; const lr = G.mode === 'versus' ? 'VERSUS' : S.round; ctx.strokeText(lr, W / 2 + 2, y + 97); ctx.fillStyle = '#fff'; ctx.fillText(lr, W / 2 + 2, y + 97); ctx.letterSpacing = '0px'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 5;
  ctx.font = `36px ${FONT}`; ctx.strokeText(S.place, W / 2, y + 144); ctx.fillStyle = '#19f5c8'; ctx.fillText(S.place, W / 2, y + 144);
  supBar(290, H - 64, 480, a.meter, false, 0); supBar(W - 290 - 480, H - 64, 480, b.meter, true, 1);
  ctx.restore();
  if (combo.shown > 0 && combo.n >= 2) {
    const left = combo.side === 0, x = left ? 60 : W - 60, sc = 1 + combo.pop * .4, col = THEME[combo.side][0], col2 = THEME[combo.side][2];
    ctx.save(); ctx.globalAlpha = combo.shown; ctx.translate(x, 420); ctx.scale(sc, sc); ctx.textAlign = left ? 'left' : 'right'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 170px ${NUM}`; ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = '#000'; ctx.strokeText(String(combo.n), 0, 0);
    ctx.lineWidth = 5; ctx.strokeStyle = col2; ctx.strokeText(String(combo.n), 0, 0); ctx.fillStyle = col; ctx.fillText(String(combo.n), 0, 0);
    const nw = ctx.measureText(String(combo.n)).width, hx = left ? nw + 14 : -nw - 14;
    ctx.font = `700 56px ${NUM}`; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText('HITS', hx, -10); ctx.fillStyle = '#fff'; ctx.fillText('HITS', hx, -10);
    ctx.font = `32px ${FONT}`; ctx.lineWidth = 5; const cs = combo.n >= 5 ? 'GREAT!' : 'COMBO'; ctx.strokeText(cs, hx, -76); ctx.fillStyle = col; ctx.fillText(cs, hx, -76);
    ctx.restore();
  }
}
function drawCutins() {
  for (const f of fx) { if (f.type !== 'cutin') continue; const t = fxAge(f); if (t < 0 || t > f.life) continue;
    const inP = EASE.out(Math.min(1, t / .16)), outP = t > f.life - .2 ? EASE.in((t - (f.life - .2)) / .2) : 0, dir = f.side === 'L' ? 1 : -1;
    const bh = 330, cy = H * .5, off = (1 - inP) * -W * dir + outP * W * dir;
    ctx.save(); ctx.globalAlpha = .45 * (1 - outP); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.translate(W / 2 + off, cy); ctx.rotate(-.06 * dir); ctx.beginPath(); ctx.rect(-W, -bh / 2, W * 2, bh); ctx.clip();
    const g = ctx.createLinearGradient(-W, 0, W, 0); g.addColorStop(0, f.col2); g.addColorStop(.5, '#0a0f24'); g.addColorStop(1, f.col2); ctx.fillStyle = g; ctx.fillRect(-W, -bh / 2, W * 2, bh);
    ctx.globalAlpha = .5; ctx.strokeStyle = f.col; ctx.lineWidth = 3;
    for (let i = 0; i < 28; i++) { const yy = -bh / 2 + (i * 53 % bh), xx = ((i * 211 + t * 2600 * dir) % (W * 2)) - W; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 260 * dir, yy); ctx.stroke(); }
    ctx.globalAlpha = 1; const img = IMG[f.img];
    if (img) { const s = bh * 1.9 / img.height, iw = img.width * s, ih = img.height * s, ix = (f.side === 'L' ? -W * .22 : W * .22) - iw / 2 + t * 40 * dir; ctx.drawImage(img, ix, -ih * .42, iw, ih); }
    ctx.font = `110px ${FONT}`; ctx.textAlign = f.side === 'L' ? 'left' : 'right'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const tx = f.side === 'L' ? W * .02 : -W * .02; ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(f.name, tx, 20); ctx.fillStyle = '#fff'; ctx.fillText(f.name, tx, 20);
    ctx.font = `40px ${FONT}`; ctx.lineWidth = 5; ctx.strokeText(f.sub, tx, -72); ctx.fillStyle = f.col; ctx.fillText(f.sub, tx, -72);
    ctx.restore();
    ctx.save(); ctx.translate(W / 2 + off, cy); ctx.rotate(-.06 * dir); ctx.fillStyle = f.col; ctx.shadowColor = f.col; ctx.shadowBlur = 20;
    ctx.fillRect(-W, -bh / 2 - 4, W * 2, 5); ctx.fillRect(-W, bh / 2 - 1, W * 2, 5); ctx.restore(); }
}
function fightImg(C) { return IMG[C.fightCut] || IMG[C.fight] || IMG[C.vs] || IMG[C.face]; }   // 9/30: FIGHT! 컷은 배경을 뺀 그림(누끼) → 판넬 색 + 물방울 무늬만 배경으로
function drawFightCut() {
  for (const f of fx) { if (f.type !== 'fightcut') continue; const t = T - f.t0; if (t < 0 || t > f.life) continue;
    const inP = EASE.out(Math.min(1, t / .32)), outA = t > f.life - .25 ? (f.life - t) / .25 : 1;
    ctx.save(); ctx.globalAlpha = outA; const sl = 180;
    for (const [side, fr, c1, dot] of [['L', G.f[0], '#7d4fa1', '#ffe600'], ['R', G.f[1], '#1a9f9d', '#ff2f8a']]) {
      const img = fightImg(fr.C), mirror = side === 'L' ? fr.C.facing !== 1 : fr.C.facing !== -1;
      ctx.save(); ctx.beginPath(); if (side === 'L') { ctx.moveTo(0, 0); ctx.lineTo(W / 2 + sl, 0); ctx.lineTo(W / 2 - sl, H); ctx.lineTo(0, H); } else { ctx.moveTo(W / 2 + sl, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W / 2 - sl, H); } ctx.closePath(); ctx.clip();
      ctx.translate((side === 'L' ? -1 : 1) * (1 - inP) * W * .6, 0); ctx.fillStyle = c1; ctx.fillRect(-W, 0, W * 3, H);
      ctx.globalAlpha = outA * .25; ctx.fillStyle = dot; for (let y = 0; y < H; y += 30) for (let x = (y / 30 % 2) * 15; x < W; x += 30) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); } ctx.globalAlpha = outA;
      if (img) { const sc = Math.max(H * 1.08 / img.height, W * .5 / img.width) * (1 + Math.min(t, 1.3) * .04), iw = img.width * sc, ih = img.height * sc, cx = side === 'L' ? W * .24 : W * .76;
        ctx.save(); if (fr.hue) ctx.filter = `hue-rotate(${fr.hue}deg)`; ctx.translate(cx, H * .5); if (mirror) ctx.scale(-1, 1); ctx.drawImage(img, -iw / 2, -ih * .5, iw, ih); ctx.restore(); }
      ctx.restore(); }
    ctx.lineWidth = 22; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(W / 2 + sl, 0); ctx.lineTo(W / 2 - sl, H); ctx.stroke(); ctx.lineWidth = 8; ctx.strokeStyle = '#ffe600'; ctx.stroke();
    const ts = t < .25 ? 3 - 2 * EASE.back(t / .25) : 1; ctx.translate(W / 2, H / 2 + 20); ctx.rotate(-.08); ctx.scale(ts, ts);
    ctx.font = `700 360px ${NUM}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 16; ctx.strokeStyle = '#000'; ctx.strokeText('FIGHT!', 0, 0); ctx.lineWidth = 7; ctx.strokeStyle = '#ff2f8a'; ctx.strokeText('FIGHT!', 0, 0);
    ctx.fillStyle = t < f.life * .45 ? '#ffe600' : '#ff2030'; ctx.fillText('FIGHT!', 0, 0); ctx.restore(); }
}
function drawWorld() {
  ctx.save();
  const sx = (Math.random() - .5) * cam.shake, sy = (Math.random() - .5) * cam.shake;
  ctx.translate(W / 2 + sx, H / 2 + sy); if (cam.rot) ctx.rotate(cam.rot); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y);
  const bg = BG[G ? G.stage : 0]; if (bg) { if (cam.rot) { ctx.fillStyle = '#000'; ctx.fillRect(-400, -400, W + 800, H + 800); } ctx.drawImage(bg, -40, -40); }
  drawStageFx('back'); drawBurst();
  if (cine.desat > .01) { ctx.save(); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = `rgba(128,128,128,${Math.min(1, cine.desat)})`; ctx.fillRect(-400, -400, W + 800, H + 800); ctx.restore(); }   // 배경만 흑백으로 (캐릭터는 색 그대로)
  if (overlay.dark > 0) { ctx.fillStyle = `rgba(10,5,30,${overlay.dark})`; ctx.fillRect(-W, -H, W * 3, H * 3); }
  if (overlay.speed > 0) { ctx.save(); ctx.globalAlpha = overlay.speed * .55; ctx.strokeStyle = overlay.speedCol; ctx.lineCap = 'round';
    for (let i = 0; i < 40; i++) { const y = (i * 97) % H, L = 200 + (i % 5) * 120, x = ((i * 331 + T * 2400 * (overlay.speedX ? -1 : 1)) % (W + L * 2) + (W + L * 2)) % (W + L * 2) - L;
      ctx.lineWidth = 2 + (i % 3) * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y); ctx.stroke(); } ctx.restore(); }
  if (G) {
    for (const f of G.f) shadow(f);
    drawFx('world');
    const order = [...G.f].sort((p, q) => (p.state === 'attack' || p.state === 'special' ? 1 : 0) - (q.state === 'attack' || q.state === 'special' ? 1 : 0));
    for (const f of order) drawFighter(f);
    for (const f of G.f) if (f.sp) { const cn = CINE[f.sp.def.cine]; if (cn && cn.draw) cn.draw(f, f.sp); }
    for (const f of G.f) if (f.state === 'down' || f.state === 'dead') for (let i = 0; i < 3; i++) { const a = T * 6 + i * 2.1; drawStar(f.x + Math.cos(a) * 90, f.y - f.C.body.crouchH * .6 + Math.sin(a) * 25, 22, '#ffe066'); }
    for (const p of G.proj) drawProj(p);
    drawFx('hits');
  }
  drawStageFx('front');
  ctx.restore();
  if (overlay.white > 0) { ctx.fillStyle = `rgba(255,250,230,${overlay.white})`; ctx.fillRect(0, 0, W, H); }
  if (ex.siren > 0) { const red = Math.sin(T * 18) > 0; ctx.save(); ctx.globalAlpha = ex.siren * .35;
    const g = ctx.createRadialGradient(red ? 0 : W, H / 2, 50, red ? 0 : W, H / 2, 1300); g.addColorStop(0, red ? '#ff2020' : '#2060ff'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  if (cine.bars < .99) { ctx.save(); ctx.globalAlpha = 1 - cine.bars; drawHud(); ctx.restore(); }   // 필살기 연출 중에는 체력바를 잠깐 숨김
  if (cine.bars > .01) { const bh = 118 * cine.bars; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh); }   // 영화처럼 위아래 검은 띠
  ctx.save(); ctx.translate(W / 2, H / 2); if (cam.rot) ctx.rotate(cam.rot); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y); drawFx('bubble'); ctx.restore();
  drawFx('screen'); drawCutins(); drawFightCut();
}

// =====================================================================
//  메뉴 화면 공통 그림 (select.html 에서 가져옴)
// =====================================================================
function label(str, x, y, size, fill, font = FONT, align = 'center', lw, weight = 700) { ctx.save(); ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = lw ?? size * .14; ctx.strokeStyle = '#000'; if (ctx.lineWidth) ctx.strokeText(str, x, y); ctx.fillStyle = fill; ctx.fillText(str, x, y); ctx.restore(); }
function slantPanel(x, y, w, h, k, flip) { ctx.beginPath(); if (!flip) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x, y + h); } else { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + k, y + h); } ctx.closePath(); }
function menuBg(tt) {
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.strokeStyle = 'rgba(255,47,138,.35)'; ctx.lineWidth = 2;
  for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 40, 620); ctx.lineTo(W / 2 + i * 260, H); ctx.stroke(); }
  for (let k = 0; k < 8; k++) { const p = ((k + (tt * .8) % 1) / 8), y = 620 + Math.pow(p, 2) * (H - 620); ctx.globalAlpha = p; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, 620); const pk = [[0, 560], [180, 470], [330, 540], [520, 400], [700, 510], [900, 430], [1080, 520], [1260, 380], [1450, 500], [1650, 440], [1800, 520], [1920, 480]];
  for (const [x, y] of pk) ctx.lineTo(x, y); ctx.lineTo(W, 620); ctx.closePath(); ctx.fillStyle = '#1a1030'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#19f5c8'; ctx.beginPath(); pk.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.font = `700 230px ${NUM}`; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
  for (const [y, sp, col, str] of [[120, 90, 'rgba(255,230,0,.22)', 'YEONGNAM ALPS  ★  '], [330, -70, 'rgba(25,245,200,.18)', 'FIGHT FOR THE MOUNTAIN  ✦  ']]) {
    ctx.strokeStyle = col; const w = ctx.measureText(str).width, off = ((tt * sp) % w + w) % w; for (let x = -off - w; x < W + w; x += w) ctx.strokeText(str, x, y); }
  ctx.restore();
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-.12); ctx.fillStyle = '#ffe600'; ctx.fillRect(-W, 330, W * 2, 26); ctx.fillStyle = '#ff2f8a'; ctx.fillRect(-W, 362, W * 2, 10);
  ctx.fillStyle = '#000'; ctx.font = `700 20px ${NUM}`; ctx.textBaseline = 'middle'; for (let x = -W + ((tt * 200) % 260); x < W; x += 260) ctx.fillText('SELECT ▶ SELECT ▶', x, 343); ctx.restore();
}
function bigFace(img, x, y, w, h, k, flip, col, locked, hue) {
  sticker(() => slantPanel(x, y, w, h, k, flip), col[1], 12);
  ctx.save(); slantPanel(x, y, w, h, k, flip); ctx.clip();
  ctx.globalAlpha = .25; ctx.fillStyle = col[0]; for (let yy = y; yy < y + h; yy += 30) for (let xx = x + ((yy / 30) % 2) * 15; xx < x + w; xx += 30) { ctx.beginPath(); ctx.arc(xx, yy, 5, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
  if (img) { if (locked) ctx.filter = 'grayscale(1) brightness(.45)'; else if (hue) ctx.filter = `hue-rotate(${hue}deg)`; const s = Math.max(w, h) / img.width * 1.02; ctx.drawImage(img, x + w / 2 - img.width * s / 2, y + h / 2 - img.height * s / 2 + 20, img.width * s, img.height * s); ctx.filter = 'none'; }
  ctx.restore(); sticker(() => slantPanel(x, y, w, h, k, flip), null, 12);
  if (locked) { lockIcon(x + w / 2, y + h / 2 - 30, 2); label('준비중', x + w / 2, y + h / 2 + 90, 70, '#fff', FONT, 'center', 10); }
}
function lockIcon(x, y, s = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineWidth = 9; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffe600';
  ctx.beginPath(); ctx.arc(0, -14, 20, Math.PI, 0); ctx.lineTo(20, 0); ctx.moveTo(-20, 0); ctx.lineTo(-20, -14); ctx.stroke(); ctx.lineWidth = 5; ctx.strokeStyle = '#ffe600'; ctx.stroke();
  ctx.beginPath(); ctx.roundRect(-30, -2, 60, 44, 8); ctx.lineWidth = 7; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.fill(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 16, 6, 0, 7); ctx.fill(); ctx.fillRect(-3, 16, 6, 14); ctx.restore(); }
function profile(c, x, y, flip) {
  const w = 560; sticker(() => slantPanel(x, y, w, 150, 40, flip), '#140828', 8);
  ctx.save(); slantPanel(x, y, w, 150, 40, flip); ctx.clip(); ctx.fillStyle = c.col[0]; ctx.fillRect(flip ? x + w - 16 : x, y, 16, 150); ctx.restore();
  const tx = flip ? x + w - 50 : x + 50, al = flip ? 'right' : 'left';
  label(c.en, tx, y + 32, 30, c.col[0], NUM, al, 0, 700); label(c.name, tx, y + 82, 64, '#fff', FONT, al, 8); label(`${c.age} · ${c.tag}`, tx, y + 128, 28, '#ffe9ff', FONT, al, 0);
}
function logo(cx, cy, s = 1) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.rotate(-.03); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.font = `170px ${FONT}`; ctx.lineWidth = 30; ctx.strokeStyle = '#1a0830'; ctx.strokeText('영남알프스를', 0, -80); ctx.lineWidth = 12; ctx.strokeStyle = '#fff'; ctx.strokeText('영남알프스를', 0, -80); ctx.fillStyle = '#19f5c8'; ctx.fillText('영남알프스를', 0, -80);
  ctx.font = `210px ${FONT}`; ctx.lineWidth = 34; ctx.strokeStyle = '#1a0830'; ctx.strokeText('지켜라!', 30, 110); ctx.lineWidth = 12; ctx.strokeStyle = '#fff'; ctx.strokeText('지켜라!', 30, 110); ctx.fillStyle = '#ffe600'; ctx.fillText('지켜라!', 30, 110);
  ctx.font = `700 42px ${NUM}`; ctx.lineWidth = 9; ctx.strokeStyle = '#1a0830'; ctx.strokeText('PROTECT THE YEONGNAM ALPS', 0, 250); ctx.fillStyle = '#ff2f8a'; ctx.fillText('PROTECT THE YEONGNAM ALPS', 0, 250);
  ctx.restore();
}
function spriteAt(key, pose, x, y, dir, alpha = 1, scale = 1) { const spr = SPR[key + '/' + pose]; if (!spr) return; const C = CHARS[key], flip = dir * C.facing * (spr.flip ? -1 : 1);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(flip * scale, scale); ctx.drawImage(spr.cv, -spr.ax, -spr.ay, spr.w, spr.h); ctx.restore(); }

// =====================================================================
//  장면(씬)
// =====================================================================
const SCENES = {};
const NOW_PLAYING_ON = { title: 1, mode: 1, select: 1, stage: 1 };
function go(name, data = {}) {
  const prev = scene.name;
  scene = Object.assign({ name, t: 0, prev }, data);
  queue = []; fx = fx.filter(f => false); tweens = [];
  if (SCENES[name] && SCENES[name].enter) SCENES[name].enter(scene);
  window.__scene = name;
}
function blink(sp = 3) { return Math.sin(performance.now() / 1000 * Math.PI * sp) > -.3; }

// ---------- 불러오기 ----------
SCENES.boot = {
  draw() { ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('불러오는 중…', W / 2, H / 2 - 40);
    const p = Math.min(1, loadDone / loadTotal); ctx.fillStyle = '#333'; ctx.fillRect(W / 2 - 400, H / 2 + 10, 800, 24); ctx.fillStyle = '#ffe600'; ctx.fillRect(W / 2 - 400, H / 2 + 10, 800 * p, 24); },
};

// ---------- 타이틀 ----------
SCENES.title = {
  enter(s) { G = null; resetFx(); STORY = false; STORY_SEEN = {}; A.bgm('select'); IN.lastInput = IN.now(); s.hold = 0; s.pend = null; },
  update(s) {
    // 숨은 박람회 설정: 펀치+킥+필살(F+G+H)을 3초 동안 함께 누르고 있기
    const m = IN.merged();
    if (m.p && m.k && m.s) { s.hold += DT; s.pend = null; if (s.hold >= 3) { A.sfx('select'); go('settings'); } return; } else s.hold = 0;
    if (s.t > .4 && (IN.p[0].pressed.d || IN.p[1].pressed.d)) { A.sfx('select'); go('movelist', { back: 'title' }); return; }   // ↓ = 기술표
    if (s.t > .4 && (IN.p[0].pressed.u || IN.p[1].pressed.u)) { A.sfx('select'); go('ranking', { from: 'title' }); return; }   // 10/2 ↑ = 순위표
    if (s.t > .4 && IN.anyPressed && s.pend == null) s.pend = s.t;   // 눌림 → 0.25초 안에 세 버튼이 다 안 눌리면 시작
    if (s.pend != null && s.t - s.pend > .3) { A.sfx('select'); go('mode'); return; }
    if (IN.idleMs() > idleMs()) startDemo();
  },
  click(x, y) { if (scene.t > .3) { A.sfx('select'); if (y > 740 && y < 790 && Math.abs(x - W / 2) < 300) go('movelist', { back: 'title' }); else if (x < 520 && y > 100 && y < 400) go('ranking', { from: 'title' }); else go('mode'); } },
  draw(s) {
    const bg = BG[2]; const z = 1.04 + Math.sin(s.t * .15) * .02;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); if (bg) ctx.drawImage(bg, -40, -40); ctx.restore();
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(10,6,30,.25)'); g.addColorStop(.6, 'rgba(10,6,30,.35)'); g.addColorStop(1, 'rgba(10,6,30,.9)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); for (let i = 0; i < 5; i++) { const x = ((s.t * (18 + i * 6) + i * 520) % (W + 800)) - 400; ctx.globalAlpha = .16; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, 640 + i * 30, 380, 40, 0, 0, 7); ctx.fill(); } ctx.restore();
    const bob = Math.sin(s.t * 4) * 8;
    if (READY.chodding) spriteAt('chodding', 'g_win', 330, 1010 + bob * .3, 1);
    if (READY.sage) spriteAt('sage', 's_flex', 1590, 1010 - bob * .3, -1);
    logo(W / 2, 330 + Math.sin(s.t * 2) * 6, 1);
    if (blink(1.4)) label('아무 버튼이나 누르면 시작!', W / 2, 660, 64, '#ffffff', FONT, 'center', 10);
    label('PRESS ANY BUTTON', W / 2, 722, 32, '#ffe600', NUM, 'center', 6);
    label('▼ 아래 = 기술표   ▲ 위 = 순위표', W / 2, 764, 30, '#19f5c8', FONT, 'center', 6);
    titleTop3(40, 104, s.t);
    drawGuide(W / 2, 800);
    if (s.hold > .3) { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, W, H); ctx.restore(); label(`박람회 설정 여는 중… ${Math.ceil(3 - s.hold)}`, W / 2, H / 2, 70, '#ffe600', FONT, 'center', 9); }
  },
};
function titleTop3(x, y, t) {   // 10/2: 타이틀 왼쪽 위 "전체 순위 TOP 3" — 들어오자마자 1등 기록이 보이게
  const list = rankLoad().slice(0, 3), w = 460, h = 70 + Math.max(1, list.length) * 74;
  ctx.save(); ctx.globalAlpha = .86; ctx.fillStyle = '#140828'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.strokeStyle = '#ffd23f'; ctx.stroke(); ctx.restore();
  label('순위 TOP 3', x + 24, y + 38, 36, '#ffe600', FONT, 'left', 6); label('▲ 전체 보기', x + w - 22, y + 38, 24, '#19f5c8', FONT, 'right', 4);
  if (!list.length) { label('첫 1등이 되어 보세요!', x + w / 2, y + 104, 32, '#fff', FONT, 'center', 5); return; }
  list.forEach((r, i) => { const yy = y + 70 + i * 74, medal = ['#ffd23f', '#d8e0ea', '#e0955a'][i], pop = i === 0 ? 1 + Math.sin(t * 5) * .04 : 1;
    label(`${i + 1}`, x + 40, yy + 34, 44 * pop, medal, NUM, 'center', 6);
    faceBox(r.key, x + 70, yy + 6, 58);
    label(String(r.name || '???').slice(0, 8), x + 142, yy + 36, 36, '#fff', NUM, 'left', 5);
    label(fmtTime(r.time), x + w - 22, yy + 36, 36, medal, NUM, 'right', 5); });
}
function drawGuide(cx, y) {
  const cols = [
    ['1P 키보드', ['이동  W A S D', '펀치 F · 킥 G · 필살기 H']],
    ['2P 키보드', ['이동  방향키 ← → ↑ ↓', '펀치 숫자1 · 킥 숫자2 · 필살기 숫자3', '(숫자패드가 없으면  ,  .  / )']],
    ['게임패드', ['이동  십자키 · 왼쪽 스틱', '펀치 A · 킥 B · 필살기 Y (또는 RB)']],
  ];
  const w = 560, gap = 20, x0 = cx - (w * 3 + gap * 2) / 2;
  cols.forEach(([t, lines], i) => { const x = x0 + i * (w + gap);
    ctx.save(); ctx.globalAlpha = .82; ctx.fillStyle = '#140828'; ctx.beginPath(); ctx.roundRect(x, y, w, 196, 20); ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.strokeStyle = THEME[i % 2][0]; ctx.stroke(); ctx.restore();
    label(t, x + w / 2, y + 36, 38, THEME[i % 2][0], FONT, 'center', 6);
    lines.forEach((l, j) => label(l, x + w / 2, y + 88 + j * 40, j === 2 ? 24 : 30, '#fff', FONT, 'center', 0));
  });
  label('뒤로 누르고 있으면 막기 · 아래 = 앉기 · 위 = 점프 · 때리면 SUPER 게이지가 차요 → 가득 차면 필살기!  ·  M(패드 Back) = 노래 바꾸기', cx, y + 232, 30, '#ffe600', FONT, 'center', 6);
}

// ---------- 박람회 설정 (숨은 화면: 타이틀에서 F+G+H 3초) ----------
const SET_ROWS = [
  { k: 'rounds', t: '혼자 하기 판 수', v: v => v === 3 ? '3판 (신불산 → 영축산 → 가지산)' : v === 2 ? '2판 (신불산 → 가지산)' : '1판 (신불산)' },
  { k: 'timer', t: '한 판 제한 시간', v: v => `${v}초` },
  { k: 'cpu', t: 'CPU 난이도', v: v => v < 0 ? '쉽게 (-1)' : v > 0 ? '어렵게 (+1)' : '보통 (0)' },
  { k: 'idle', t: '데모까지 기다리는 시간', v: v => `${v}초 동안 안 만지면` },
  { k: 'comic', t: '만화 컷씬 (스토리 모드)', v: v => v ? '켜기' : '끄기' },
  { k: 'rank', t: '순위 기록 지우기', v: (_, s) => s.rankArm ? '펀치를 한 번 더 누르면 지워요!' : s.rankDone ? '지웠어요' : `펀치 두 번 (${SET.rounds}판 기록 ${s.rankN}개)`, act: true },
  { k: 'exit', t: '저장하고 나가기', v: () => '펀치 · 킥', act: true },
];
SCENES.settings = {
  enter(s) { s.sel = 0; s.rankArm = false; s.rankDone = false; s.lastIn = 0; s.rankN = rankLoad().length; },
  change(s, d) {
    const row = SET_ROWS[s.sel]; if (row.act) return;
    const o = SET_OPTS[row.k]; let i = o.indexOf(SET[row.k]); if (i < 0) i = o.indexOf(SET_DEF[row.k]);
    SET[row.k] = o[(i + d + o.length) % o.length]; delete SET_URL[row.k]; settingsSave(); A.sfx('move'); s.rankN = rankLoad().length; s.rankDone = false;
  },
  act(s) {
    const k = SET_ROWS[s.sel].k;
    if (k === 'rank') { if (s.rankArm) { const l = rankAll().filter(r => (r.rounds || 3) !== SET.rounds); try { localStorage.setItem(RANK_KEY, JSON.stringify(l)); } catch (e) {} s.rankArm = false; s.rankDone = true; s.rankN = 0; A.sfx('deny'); } else { s.rankArm = true; A.sfx('blip'); } }
    else if (k === 'exit') this.exit();
    else this.change(s, 1);
  },
  exit() { settingsSave(); A.sfx('select'); go('title'); },
  update(s) {
    const p = IN.merged();
    if (p.any) s.lastIn = s.t;
    if (p.pressed.u) { s.sel = (s.sel + SET_ROWS.length - 1) % SET_ROWS.length; s.rankArm = false; A.sfx('move'); }
    if (p.pressed.d) { s.sel = (s.sel + 1) % SET_ROWS.length; s.rankArm = false; A.sfx('move'); }
    if (p.pressed.l) this.change(s, -1); if (p.pressed.r) this.change(s, 1);
    if (s.t > .6 && (p.pressed.p || p.pressed.start)) this.act(s);
    if (s.t > .6 && p.pressed.k) this.exit();
    if (s.t - s.lastIn > 60) this.exit();                            // 1분 동안 안 만지면 저장하고 타이틀로
  },
  click(x, y) { const s = scene; for (let i = 0; i < SET_ROWS.length; i++) { const r = setRect(i); if (y > r.y && y < r.y + r.h && x > r.x && x < r.x + r.w) { s.lastIn = s.t; if (s.sel !== i) { s.sel = i; s.rankArm = false; A.sfx('move'); } else if (SET_ROWS[i].act) this.act(s); else this.change(s, x > r.x + r.w * .55 ? 1 : -1); return; } } },
  draw(s) {
    menuBg(s.t);
    label('박람회 설정', W / 2, 90, 84, '#ffe600', FONT, 'center', 12);
    label('EXHIBITION SETTINGS  ·  바로 저장돼요', W / 2, 162, 32, '#19f5c8', FONT, 'center', 0);
    SET_ROWS.forEach((row, i) => { const r = setRect(i), on = s.sel === i;
      sticker(() => { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 18); }, on ? '#7b2cff' : '#241238', on ? 10 : 6);
      label(row.t, r.x + 40, r.y + r.h / 2 + 2, 44, on ? '#ffe600' : '#fff', FONT, 'left', 7);
      const val = row.v(SET[row.k], s);
      label(row.act ? val : `◀  ${val}  ▶`, r.x + r.w - 40, r.y + r.h / 2 + 2, 40, row.k === 'rank' && s.rankArm ? '#ff4040' : on ? '#fff' : '#c9b8ff', FONT, 'right', 6);
      if (SET_URL[row.k]) label('주소 값 우선', r.x + r.w - 40, r.y + 14, 20, '#ff8ad0', FONT, 'right', 0);
    });
    label('▲ ▼ 고르기 · ◀ ▶ 바꾸기 · 펀치 = 실행 · 킥 = 저장하고 나가기', W / 2, 1000, 36, '#fff', FONT, 'center', 6);
    label(`지금: ${SET.rounds}판 · ${SET.timer}초 · CPU ${SET.cpu > 0 ? '+1' : SET.cpu}  ·  데모 ${SET.idle}초  ·  만화 ${SET.comic ? '켜기' : '끄기'}`, W / 2, 1046, 28, '#19f5c8', FONT, 'center', 5);
  },
};
function setRect(i) { return { x: W / 2 - 760, y: 206 + i * 108, w: 1520, h: 92 }; }

// ---------- 모드 선택 ----------
const MODE_CARDS = [
  { t: '스토리 모드', get s() { return SET.comic ? `만화와 함께 산신령과 ${SET.rounds}판!` : `산신령과 ${SET.rounds}판 대결! (만화 꺼짐)`; }, d: '1P  VS  CPU', col: THEME[0] },
  { t: '대전 모드', s: '만화 없이 바로 대결!', d: '', col: THEME[1] },
];
const VS_SUBS = ['1P VS CPU', '1P VS 2P'];   // 대전 모드 안에서 고르기
function modeRect(i) { return { x: W / 2 - 760 + i * 800, y: 262, w: 720, h: 600 }; }
function subRect(j) { const r = modeRect(1); return { x: r.x + r.w / 2 - 320 + j * 330, y: r.y + 196, w: 310, h: 64 }; }
function modeGo(i, sub) {   // 0 = 스토리 모드(1P vs CPU + 만화) · 1 = 대전 모드(sub 0 = 1P vs CPU, 1 = 1P vs 2P, 만화 없음)
  A.sfx('select'); STORY = i === 0; STORY_SEEN = {};
  go('music', { mode: i === 0 || sub === 0 ? 'arcade' : 'versus' });
}
SCENES.mode = {
  enter(s) { s.sel = s.sel || 0; s.sub = s.sub || 0; A.bgm('select'); },
  update(s) {
    const a = IN.p[0], b = IN.p[1];
    for (const p of [a, b]) { if (p.pressed.l || p.pressed.r) { s.sel = 1 - s.sel; A.sfx('move'); } }
    if (s.sel === 1 && (a.pressed.u || b.pressed.u || a.pressed.d || b.pressed.d)) { s.sub = 1 - s.sub; A.sfx('move'); return; }   // 대전 모드: ▲▼ = 1P VS CPU / 1P VS 2P
    if (s.t > .25 && (a.pressed.p || b.pressed.p || a.pressed.start || b.pressed.start || a.pressed.s || b.pressed.s)) { modeGo(s.sel, s.sub); return; }
    if (a.pressed.k || b.pressed.k) { A.sfx('back'); go('title'); }
    if (a.pressed.d || b.pressed.d) { A.sfx('select'); go('movelist', { back: 'mode' }); return; }
    if (IN.idleMs() > idleMs()) go('title');
  },
  click(x, y) {
    for (let j = 0; j < 2; j++) { const r = subRect(j); if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { scene.sel = 1; scene.sub = j; modeGo(1, j); return; } }   // 대전 모드 안 버튼 = 바로 시작
    for (let i = 0; i < 2; i++) { const r = modeRect(i); if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { if (scene.sel === i) modeGo(i, scene.sub); else { scene.sel = i; A.sfx('move'); } } }
  },
  draw(s) {
    menuBg(s.t);
    label('게임 방법을 고르세요', W / 2, 140, 84, '#ffe600', FONT, 'center', 12);
    label('SELECT MODE', W / 2, 220, 34, '#19f5c8', NUM, 'center', 0);
    MODE_CARDS.forEach((c, i) => { const r = modeRect(i), on = s.sel === i, sc = on ? 1.04 + Math.sin(s.t * 6) * .01 : .96;
      ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(sc, sc); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2)); ctx.globalAlpha = on ? 1 : .6;
      sticker(() => slantPanel(r.x, r.y, r.w, r.h, 60, i === 1), on ? c.col[2] : '#241238', 12);
      if (i === 0) { spriteAt('chodding', 'g_punch2', r.x + 240, r.y + r.h - 24, 1, 1, .6); spriteAt('sage', 's_guard2', r.x + 520, r.y + r.h - 24, -1, 1, .46); }
      else { spriteAt('chodding', 'g_kick', r.x + 250, r.y + r.h - 24, 1, 1, .6); spriteAt('chodding', 'g_block', r.x + 500, r.y + r.h - 24, -1, 1, .6); }
      label(c.t, r.x + r.w / 2, r.y + 80, 96, on ? c.col[0] : '#fff', FONT, 'center', 12);
      label(c.s, r.x + r.w / 2, r.y + 165, 44, '#fff', FONT, 'center', 7);
      if (i === 0) label(c.d, r.x + r.w / 2, r.y + 222, 40, c.col[0], NUM, 'center', 6);
      else for (let j = 0; j < 2; j++) { const b = subRect(j), pk = s.sub === j;
        sticker(() => { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 32); }, pk ? c.col[0] : 'rgba(20,10,40,.85)', pk ? 7 : 5);
        label(VS_SUBS[j], b.x + b.w / 2, b.y + b.h / 2 + 2, 36, pk ? '#1a0830' : '#fff', NUM, 'center', pk ? 0 : 5); }
      ctx.restore();
      if (on) { const ax = r.x + r.w / 2, ay = r.y + r.h + 50 + Math.sin(s.t * 8) * 6; ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.moveTo(ax - 30, ay + 20); ctx.lineTo(ax + 30, ay + 20); ctx.lineTo(ax, ay - 20); ctx.closePath(); ctx.fill(); }
    });
    label(s.sel === 1 ? '← → 모드 · ▲▼ 1P VS CPU / 1P VS 2P · 펀치로 결정 · 킥 = 뒤로' : '← → 로 고르고  펀치(F · A버튼)로 결정  ·  킥(G · B버튼) = 뒤로  ·  ↓ = 기술표', W / 2, 1010, 34, '#fff', FONT, 'center', 6);
  },
};

// ---------- 스토리 모드: 만화 컷씬 (story/c01~c04.mp4 · 원본은 comic/ 폴더) ----------
//  각 산 첫 대결 전에 한 번씩 (이어하기·캐릭터 다시 골라도 같은 판 만화는 다시 안 나옴) · 마지막 판 이기면 엔딩 만화 → 이름 입력/순위표
//  아무 버튼·화면 누르기 = 건너뛰기 · 만화 나오는 동안 게임 음악은 멈췄다가 끝나면 이어서 · 박람회 설정 '만화 컷씬'으로 끌 수 있음
const STORY_CLIPS = { 0: 'story/c01.mp4', 1: 'story/c02.mp4', 2: 'story/c03.mp4', end: 'story/c04.mp4' };
let STORY = false, STORY_SEEN = {};
const storyOn = () => STORY && SET.comic === 1;
function toVs(match) {
  if (match.mode === 'arcade' && storyOn() && STORY_CLIPS[match.stage] && !STORY_SEEN[match.stage]) {
    STORY_SEEN[match.stage] = 1; return go('comic', { src: STORY_CLIPS[match.stage], after: () => go('vs', { match }) });
  }
  go('vs', { match });
}
let comicEl = null;
function comicBox() {
  if (comicEl) return comicEl;
  const st = document.createElement('style');
  st.textContent = '#comic{position:fixed;inset:0;z-index:4;background:#000;display:none;touch-action:none}#comic video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}' +
    '#comic .hint{position:absolute;right:14px;bottom:12px;font:20px "Jua",sans-serif;color:#fff;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.35);padding:7px 14px;border-radius:10px;opacity:0;transition:opacity .4s;pointer-events:none}#comic .hint.on{opacity:1}';
  document.head.appendChild(st);
  const wrap = document.createElement('div'); wrap.id = 'comic';
  wrap.innerHTML = '<video playsinline webkit-playsinline preload="auto"></video><div class="hint"></div>';
  document.body.appendChild(wrap);
  comicEl = { wrap, v: wrap.querySelector('video'), hint: wrap.querySelector('.hint') };
  wrap.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); IN.lastInput = IN.now(); if (scene.name === 'comic') SCENES.comic.tap(scene); });
  return comicEl;
}
SCENES.comic = {
  enter(s) {
    const c = comicBox(); s.done = false; s.muted = false; s.lastT = -1; s.stall = 0;
    A.bgmHold(true);                                  // 게임 음악 멈춤 (끝나면 이어서)
    c.v.muted = false; c.v.src = s.src; c.wrap.style.display = 'block'; c.hint.classList.remove('on');
    c.v.onended = () => this.finish(s);
    c.v.onerror = () => { console.info('[만화] 영상을 못 불러와 건너뜀:', s.src); this.finish(s); };
    const pr = c.v.play();
    if (pr && pr.catch) pr.catch(() => { if (s.done) return; c.v.muted = true; s.muted = true; c.v.play().catch(() => {}); });   // 소리 자동재생이 막히면 소리 없이 시작 + '누르면 소리 켜기'
  },
  finish(s) {
    if (s.done) return; s.done = true;
    const c = comicEl; c.v.onended = c.v.onerror = null; try { c.v.pause(); c.v.removeAttribute('src'); c.v.load(); } catch (e) {}
    c.wrap.style.display = 'none'; c.hint.classList.remove('on');
    A.bgmHold(false); A.bgm('resume'); IN.lastInput = IN.now();
    s.after();
  },
  tap(s) {
    A.unlock(); if (s.done) return;
    if (s.muted) { comicEl.v.muted = false; s.muted = false; return; }   // 처음 누르면 소리만 켜기
    if (s.t > .3) { A.sfx('select'); this.finish(s); }
  },
  update(s) {
    if (s.done) return;
    const c = comicEl;
    if (s.t > .3 && IN.anyPressed) { A.sfx('select'); this.finish(s); return; }   // 아무 버튼 = 건너뛰기
    if (s.t > 1) { c.hint.textContent = s.muted ? '화면을 누르면 소리 켜기 · 아무 버튼이나 누르면 건너뛰기' : '아무 버튼이나 누르면 건너뛰기'; c.hint.classList.add('on'); }
    const ct = c.v.currentTime;                         // 영상이 12초 넘게 멈춰 있으면 (인터넷 끊김 등) 그냥 다음으로
    if (ct === s.lastT) s.stall += DT; else { s.stall = 0; s.lastT = ct; }
    if (s.stall > 12) { console.info('[만화] 재생이 멈춰 건너뜀:', s.src); this.finish(s); }
  },
  draw() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); },
};

// ---------- 배경음악 고르기 (모드 선택 다음, 캐릭터 선택 전) ----------
// 여기서 고른 한 곡이 캐릭터 선택·대전·K.O.·이어하기·순위표까지 계속 흐름. 곡을 바꾸는 길은 audio.js A.setTrack 하나뿐 (이 화면 + 어디서나 M키 '다음 곡')
const MUSIC_COL = ['#ff2f8a', '#ffe600', '#19f5c8', '#00b3ff', '#c3c6d6'];   // 마지막 = 음악 끄기
const MUSIC_AUTO_SEC = 10;                                             // 전시용: 10초 동안 아무것도 안 누르면 지금 곡으로 결정
function musicRect(i) { return { x: W / 2 - 540, y: 244 + i * 138, w: 1080, h: 124 }; }   // 5칸(4곡 + 음악 끄기)
function eqBars(x, y, w, h, n, t, on, col) {   // 작은 이퀄라이저 (막대만)
  const bw = w / n * .62, gap = w / n * .38;
  for (let i = 0; i < n; i++) { const v = on ? .25 + .75 * Math.abs(Math.sin(t * (5.3 + i * 1.7) + i * 1.3) * Math.sin(t * (2.1 + i * .6) + i)) : .12;
    const bh = Math.max(6, h * v), bx = x + i * (bw + gap);
    ctx.fillStyle = '#000'; ctx.fillRect(bx - 3, y - bh - 3, bw + 6, bh + 6); ctx.fillStyle = on ? col : 'rgba(255,255,255,.35)'; ctx.fillRect(bx, y - bh, bw, bh); }
}
// '다음 곡' (M · Tab · 패드 Back · 화면 ♪ 버튼) — 어디서든. 곡 바꾸기는 audio.js A.setTrack 한 길로만
// 곡 아이콘 — 이모지 대신 캔버스로 직접 그림 (기기마다 모양이 달라지지 않게). 중심 (x, y), 한 변 약 s
function songIcon(id, x, y, s, t = 0, on = true) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 100, s / 100); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const O = '#000', dot = (cx, cy, r, c) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = O; ctx.stroke(); };
  if (id === 'citypop') {            // LP 레코드판
    ctx.rotate(on ? t * 2.2 : 0);
    ctx.beginPath(); ctx.arc(0, 0, 46, 0, 7); ctx.fillStyle = '#16161c'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = O; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.22)'; for (const r of [38, 32, 26]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(0, 0, 35, -2.4, -1.7); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fillStyle = '#ff2f8a'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = O; ctx.stroke();
    ctx.fillStyle = '#ffe600'; ctx.fillRect(-9, -5, 18, 3);
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fillStyle = '#000'; ctx.fill();
  } else if (id === 'pansori') {     // 소리북 + 북채 (9/29 고침: 징(쇠못)은 몸통 가운데가 아니라 양쪽 가죽면 테두리를 빙 둘러 박힘)
    ctx.rotate(-.12);
    const nx = 26, nrx = 15, nry = 37, fx0 = -30, frx = 12, fry = 32;   // 앞 가죽면(보이는 쪽)·뒤 가죽면(반대쪽) 타원
    const rimArc = (cx, rx, ry) => { ctx.beginPath(); ctx.ellipse(cx, 0, rx, ry, 0, Math.PI / 2, Math.PI * 1.5); };   // 몸통을 두르는 선(앞쪽 반원)
    const tack = (cx, cy) => { ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 7); ctx.fillStyle = '#f4d774'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = O; ctx.stroke(); };
    // 통(옻칠한 붉은 갈색 나무) — 옆으로 누운 배불뚝 통
    const body = () => { ctx.beginPath(); ctx.moveTo(fx0, -fry); ctx.quadraticCurveTo(-2, -48, nx, -nry); ctx.lineTo(nx, nry); ctx.quadraticCurveTo(-2, 48, fx0, fry); ctx.ellipse(fx0, 0, frx, fry, 0, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); };
    body(); ctx.fillStyle = '#9a3a20'; ctx.fill();
    ctx.save(); body(); ctx.clip();
    ctx.fillStyle = 'rgba(255,190,150,.28)'; ctx.beginPath(); ctx.ellipse(-4, -26, 30, 7, -.04, 0, 7); ctx.fill();   // 옻칠 광택
    ctx.fillStyle = 'rgba(40,8,0,.28)'; ctx.beginPath(); ctx.ellipse(-4, 36, 36, 10, 0, 0, 7); ctx.fill();          // 아래 그늘
    // 가죽면 가까이 두른 띠(얇은 선) — 양쪽
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#4a1608'; rimArc(nx - 11, nrx, nry + 2); ctx.stroke(); rimArc(fx0 + 11, frx, fry + 5); ctx.stroke();
    ctx.restore();
    body(); ctx.lineWidth = 6; ctx.strokeStyle = O; ctx.stroke();
    // 뒤쪽 가죽면 테두리의 징 — 몸통을 두른 앞쪽 반원만 보임
    for (let i = 1; i < 10; i++) { const a = Math.PI / 2 + i / 10 * Math.PI; tack(fx0 + 5 + Math.cos(a) * frx, Math.sin(a) * (fry + 1)); }
    // 앞쪽 가죽면(연한 가죽) + 가장자리를 빙 두른 징
    ctx.beginPath(); ctx.ellipse(nx, 0, nrx, nry, 0, 0, 7); ctx.fillStyle = '#e6c994'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = O; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(nx + 1, 2, nrx * .55, nry * .6, 0, 0, 7); ctx.fillStyle = 'rgba(150,100,50,.22)'; ctx.fill();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; tack(nx + Math.cos(a) * (nrx - 4.5), Math.sin(a) * (nry - 4.5)); }
    // 북채
    ctx.save(); ctx.translate(12, -34); ctx.rotate(.95 + (on ? Math.sin(t * 9) * .15 : 0));
    ctx.lineWidth = 12; ctx.strokeStyle = O; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -56); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = '#d9a35c'; ctx.stroke(); ctx.restore();
  } else if (id === 'off') {         // 음악 끄기 — 스피커 + 빗금
    ctx.beginPath(); ctx.moveTo(-40, -14); ctx.lineTo(-22, -14); ctx.lineTo(2, -36); ctx.lineTo(2, 36); ctx.lineTo(-22, 14); ctx.lineTo(-40, 14); ctx.closePath();
    ctx.fillStyle = on ? '#dfe1ea' : '#a9acbc'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = O; ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.35)'; for (const r of [18, 32]) { ctx.beginPath(); ctx.arc(4, 0, r, -.8, .8); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-38, -38); ctx.lineTo(40, 38); ctx.lineWidth = 17; ctx.strokeStyle = O; ctx.stroke(); ctx.lineWidth = 9; ctx.strokeStyle = '#ff2f5a'; ctx.stroke();
  } else if (id === 'trot') {        // 옛날 마이크 + 반짝이 (둥근 점)
    ctx.lineWidth = 12; ctx.strokeStyle = O; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, 40); ctx.stroke(); ctx.lineWidth = 6; ctx.strokeStyle = '#b8b8c8'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 44, 26, 8, 0, 0, 7); ctx.fillStyle = '#b8b8c8'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = O; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-11, 4, 22, 16, 5); ctx.fillStyle = '#ff2f8a'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = O; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-22, -46, 44, 54, 22); ctx.fillStyle = '#e4e4ee'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = O; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.roundRect(-22, -46, 44, 54, 22); ctx.clip(); ctx.lineWidth = 2; ctx.strokeStyle = '#8a8aa0';
    for (let k = -40; k <= 6; k += 8) { ctx.beginPath(); ctx.moveTo(-24, k); ctx.lineTo(24, k); ctx.stroke(); } for (let k = -16; k <= 16; k += 8) { ctx.beginPath(); ctx.moveTo(k, -48); ctx.lineTo(k, 10); ctx.stroke(); } ctx.restore();
    ctx.fillStyle = '#ffe600'; ctx.fillRect(-22, -10, 44, 6); ctx.lineWidth = 3; ctx.strokeStyle = O; ctx.strokeRect(-22, -10, 44, 6);
    const tw = on ? t * 5 : 0;
    [[-40, -34, 6, '#ffe600', 0], [38, -40, 5, '#19f5c8', 1.4], [42, -8, 4, '#ff2f8a', 2.6], [-38, 0, 4, '#ffe600', 3.7]].forEach(([sx, sy, r, c, ph]) => dot(sx, sy, r * (on ? .75 + .35 * Math.abs(Math.sin(tw + ph)) : .8), c));
  } else if (id === 'jazz') {        // 색소폰
    const path = () => { ctx.beginPath(); ctx.moveTo(-26, -44); ctx.lineTo(-10, -36); ctx.lineTo(-6, -30); ctx.lineTo(-6, 20); ctx.quadraticCurveTo(-4, 44, 14, 42); ctx.quadraticCurveTo(28, 40, 28, 22); ctx.lineTo(28, 2); };
    path(); ctx.lineWidth = 22; ctx.strokeStyle = O; ctx.stroke(); path(); ctx.lineWidth = 13; ctx.strokeStyle = '#ffc234'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, 6); ctx.lineTo(39, 6); ctx.lineTo(46, -12); ctx.lineTo(10, -12); ctx.closePath(); ctx.fillStyle = '#ffc234'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = O; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(28, -12, 18, 5, 0, 0, 7); ctx.fillStyle = '#7a4a00'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-26, -44); ctx.lineTo(-34, -47); ctx.lineWidth = 8; ctx.strokeStyle = O; ctx.stroke();
    for (const ky of [-18, -6, 6, 18]) dot(-6, ky, 3.5, '#fff6c8');
    if (on) { const b = Math.sin(t * 6); dot(46 + b * 3, -30 - Math.abs(b) * 4, 4, '#19f5c8'); dot(38 - b * 2, -42, 3, '#ff2f8a'); }
  }
  ctx.restore();
}
let toastAt = -1e9, toastName = '', toastId = '';
function songLabel(m) { return m && m.off ? '♪ 음악 끔' : '♪ ' + (m ? m.name : ''); }
function nextSong() { const m = A.nextTrack(); toastName = songLabel(m); toastId = m.id; toastAt = performance.now(); if (scene.name === 'music') scene.lastIn = scene.t; }
IN.onMusic = nextSong;
{ const mb = document.getElementById('musicBtn'); if (mb) mb.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); nextSong(); }); }
let musicBtnOff = null;
function syncMusicBtn() {   // 화면 ♪ 버튼: 음악 끄면 빗금 친 음표
  const off = !!(A.musicOff && A.musicOff()); if (off === musicBtnOff) return; musicBtnOff = off;
  const mb = document.getElementById('musicBtn'); if (mb) { mb.classList.toggle('off', off); mb.title = off ? '음악 꺼짐 — 누르면 시티팝 (M · Tab · 패드 Back)' : '다음 곡 (M · Tab · 패드 Back)'; }
}
function songToast() {
  syncMusicBtn();
  const a = (performance.now() - toastAt) / 1000; if (a < 0 || a > 1.6) return;
  const k = Math.min(1, a / .12, (1.6 - a) / .25); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = k;
  ctx.font = `700 54px ${FONT}`; const tw0 = ctx.measureText(toastName).width, w = tw0 + 200, y = 120 - (1 - k) * 30, x0 = W / 2 - w / 2;
  sticker(() => { ctx.beginPath(); ctx.roundRect(x0, y - 50, w, 100, 50); }, '#7b2cff', 10);
  songIcon(toastId, x0 + 78, y, 76, performance.now() / 1000, true);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(toastName, x0 + 136, y + 3); ctx.fillStyle = '#ffe600'; ctx.fillText(toastName, x0 + 136, y + 3); ctx.restore();
}
function nowPlaying(t) {   // 타이틀·선택 화면 왼쪽 위: ♪ 지금 곡
  const m = A.music && A.music(); if (!m) return; const txt = songLabel(m);
  ctx.save(); ctx.font = `700 30px ${FONT}`; const tw0 = ctx.measureText(txt).width, w = tw0 + 110;
  ctx.globalAlpha = .88; ctx.fillStyle = '#140828'; ctx.beginPath(); ctx.roundRect(24, 22, w, 56, 28); ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeStyle = '#19f5c8'; ctx.stroke(); ctx.restore();
  label(txt, 48, 51, 30, '#19f5c8', FONT, 'left', 0);
  eqBars(48 + tw0 + 16, 66, 44, 30, 4, t, !m.off, '#ffe600');
}
SCENES.music = {
  enter(s) { const ids = A.MUSIC.map(m => m.id); s.sel = Math.max(0, ids.indexOf(A.musicId())); s.lastIn = 0; A.bgm('select'); },
  move(s, d) { s.sel = (s.sel + d + A.MUSIC.length) % A.MUSIC.length; s.lastIn = s.t; A.sfx('move'); A.setTrack(s.sel); },
  confirm(s) { A.sfx('select'); A.setTrack(s.sel); go('select', { mode: s.mode || 'arcade' }); },
  update(s) {
    const a = IN.p[0], b = IN.p[1];
    s.sel = Math.max(0, A.MUSIC.findIndex(m => m.id === A.musicId()));   // M키로 바꿔도 칸이 따라가게
    for (const p of [a, b]) { if (p.pressed.u || p.pressed.l) return this.move(s, -1); if (p.pressed.d || p.pressed.r) return this.move(s, 1); }
    if (s.t > .25 && (a.pressed.p || b.pressed.p || a.pressed.start || b.pressed.start || a.pressed.s || b.pressed.s)) return this.confirm(s);
    if (a.pressed.k || b.pressed.k) { A.sfx('back'); go('mode', { sel: s.mode === 'versus' ? 1 : 0 }); return; }
    if (s.t - s.lastIn > MUSIC_AUTO_SEC) this.confirm(s);
  },
  click(x, y) { const s = scene; for (let i = 0; i < A.MUSIC.length; i++) { const r = musicRect(i); if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { if (s.sel === i) this.confirm(s); else { s.sel = i; s.lastIn = s.t; A.sfx('move'); A.setTrack(i); } return; } } },
  draw(s) {
    menuBg(s.t);
    label('배경음악을 고르세요', W / 2, 140, 84, '#ffe600', FONT, 'center', 12);
    label('SELECT MUSIC', W / 2, 220, 34, '#19f5c8', NUM, 'center', 0);
    const beat = Math.abs(Math.sin(s.t * Math.PI * 2.2));
    if (READY.chodding) spriteAt('chodding', 'g_win', 250, 1000 - beat * 22, 1, 1, .78);
    if (READY.sage) spriteAt('sage', 's_flex', W - 250, 1000 - (1 - beat) * 22, -1, 1, .62);
    A.MUSIC.forEach((m, i) => { const r = musicRect(i), on = s.sel === i, col = MUSIC_COL[i % MUSIC_COL.length], sc = on ? 1.03 + Math.sin(s.t * 6) * .006 : .97;
      ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(sc, sc); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
      sticker(() => slantPanel(r.x, r.y, r.w, r.h, 44, i % 2 === 1), on ? '#7b2cff' : '#241238', on ? 12 : 8);
      ctx.save(); slantPanel(r.x, r.y, r.w, r.h, 44, i % 2 === 1); ctx.clip(); ctx.fillStyle = col; ctx.fillRect(r.x, r.y, 22, r.h); ctx.fillRect(r.x + r.w - 22, r.y, 22, r.h); ctx.restore();
      songIcon(m.id, r.x + 120, r.y + r.h / 2, 104, s.t, on);
      label(m.name, r.x + 210, r.y + 48, 58, on ? col : '#fff', FONT, 'left', 10);
      label(m.sub, r.x + 212, r.y + 97, 30, '#ffe9ff', FONT, 'left', 5);
      eqBars(r.x + r.w - 250, r.y + r.h - 26, 170, 76, 7, s.t, on && !m.off, col);
      if (on) label(m.off ? '조용~' : '♪ 듣는 중', r.x + r.w - 165, r.y + 22, 26, '#fff', FONT, 'center', 5);
      ctx.restore();
      if (on) { const ax = r.x - 46 + Math.sin(s.t * 8) * 8, ay = r.y + r.h / 2; ctx.fillStyle = '#ffe600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(ax - 22, ay - 30); ctx.lineTo(ax + 22, ay); ctx.lineTo(ax - 22, ay + 30); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    });
    const left = Math.max(0, Math.ceil(MUSIC_AUTO_SEC - (s.t - s.lastIn)));
    label(A.musicOff && A.musicOff() ? `${left}초 뒤에 음악 없이 시작해요!` : `${left}초 뒤에 이 노래로 시작해요!`, W / 2, 958, 34, '#ffe600', FONT, 'center', 6);
    label('↑ ↓ 로 골라 들어 보고  펀치(F · A버튼)로 결정  ·  킥(G · B버튼) = 뒤로  ·  게임 중에도 M = 다음 곡 · 음악 끄기', W / 2, 1018, 34, '#fff', FONT, 'center', 6);
  },
};

// ---------- 캐릭터 선택 ----------
const ROSTER_N = ROSTER.length, BOSS_I = ROSTER_N, RAND_I = ROSTER_N + 1, TILE_N = ROSTER_N + 2, TILE_COLS = 4; // 10/2: 캐릭터 + 산신령 + 랜덤, 4칸씩
function tileInfo(i) {
  if (i < ROSTER_N) { const r = ROSTER[i], C = CHARS[r.key]; return Object.assign({}, r, C ? { name: C.name, en: C.en, age: C.age, tag: C.tag, col: C.col } : {}, { key: r.key, img: IMG[r.face] }); }
  if (i === BOSS_I) { const C = CHARS[BOSS]; return { key: BOSS, name: C.name, en: C.en, age: C.age, tag: C.tag, col: C.col, img: IMG[C.face], boss: true }; }
  return { key: 'random', name: '랜덤', en: 'RANDOM', age: '?', tag: '누가 나올까?', col: ['#ffffff', '#444466'], img: null };
}
function tileRect(i) { const s = 150, g = 14, col = i % TILE_COLS, row = Math.floor(i / TILE_COLS), rows = Math.ceil(TILE_N / TILE_COLS); return { x: W / 2 - (TILE_COLS * s + (TILE_COLS - 1) * g) / 2 + col * (s + g), y: 560 - (rows - 2) * (s + g) + row * (s + g), s }; }   // 줄이 늘면 위로 올라감
function allowed(i, side, mode) {
  if (i === RAND_I) return true; const t = tileInfo(i);
  if (!READY[t.key]) return false;
  if (i === BOSS_I) return mode === 'versus' && side === 1;
  return true;
}
function resolvePick(i, side, mode) {
  if (i !== RAND_I) return tileInfo(i).key;
  const opts = []; for (let k = 0; k < RAND_I; k++) if (allowed(k, side, mode)) opts.push(tileInfo(k).key);
  return pick(opts);
}
SCENES.select = {
  enter(s) {
    A.bgm('select');
    const keep = s.keep && window.__lastPick;
    s.cur = keep ? [...window.__lastPick.cur] : [0, BOSS_I]; s.done = [false, false]; s.picked = [null, null]; s.shake = [0, 0]; s.goT = -1;
    if (s.mode === 'arcade') s.done[1] = true;
  },
  update(s) {
    const players = s.mode === 'arcade' ? [IN.merged()] : [IN.p[0], IN.p[1]];
    players.forEach((p, side) => {
      if (s.goT >= 0) return;
      if (!s.done[side]) {
        let c = s.cur[side];
        if (p.pressed.l) c = (c + TILE_N - 1) % TILE_N; if (p.pressed.r) c = (c + 1) % TILE_N;
        if (p.pressed.u) c = (c - TILE_COLS + TILE_N * 2) % TILE_N; if (p.pressed.d) c = (c + TILE_COLS) % TILE_N;
        if (c !== s.cur[side]) { s.cur[side] = c; A.sfx('move'); }
        if ((p.pressed.p || p.pressed.start || p.pressed.s) && s.t > .3) this.confirm(s, side);
        if (p.pressed.k && side === 0) { A.sfx('back'); go('music', { mode: s.mode }); }
      } else if (p.pressed.k && s.mode === 'versus') { s.done[side] = false; A.sfx('back'); }
    });
    s.shake = s.shake.map(v => Math.max(0, v - DT * 3));
    if (s.goT < 0 && s.done[0] && s.done[1]) { s.goT = s.t; A.sfx('select'); }
    if (s.goT >= 0 && s.t - s.goT > .9) {
      window.__lastPick = { cur: [...s.cur] };
      if (s.mode === 'arcade') { const st = s.resume ?? arcadeSeq()[0];   // resume = 졌던 판부터 이어서 (캐릭터를 바꿔도 이어서 — 여러 캐릭터 해 보게, 10/2 다래)
        if (s.resume == null) RUN = { time: 0, cont: 0 }; else if (RUN) RUN.cont++;
        toVs({ mode: 'arcade', stage: st, p1: s.picked[0], p2: BOSS, ai: [null, aiFor(st)] }); }
      else go('stage', { p1: s.picked[0], p2: s.picked[1] });
    }
    if (IN.idleMs() > idleMs()) go('title');
  },
  confirm(s, side) {
    const i = s.cur[side];
    if (!allowed(i, side, s.mode)) { s.shake[side] = 1; A.sfx('deny'); const t = tileInfo(i); pop(i === BOSS_I ? '보스는 2P만!' : '준비중이에요!', tileRect(i).x + 75, tileRect(i).y - 10, '#ff8ad0', 44); return; }
    s.picked[side] = resolvePick(i, side, s.mode); s.done[side] = true; A.sfx('select');
    const C = CHARS[s.picked[side]]; if (C && C.voices && C.voices.intro) A.voice(C.voices.intro, .9);
  },
  click(x, y) { const s = scene; for (let i = 0; i < TILE_N; i++) { const r = tileRect(i); if (x > r.x && x < r.x + r.s && y > r.y && y < r.y + r.s) {
    const side = s.mode === 'versus' && s.done[0] ? 1 : 0; if (s.done[side]) return; if (s.cur[side] === i) this.confirm(s, side); else { s.cur[side] = i; A.sfx('move'); } } } },
  draw(s) {
    menuBg(s.t);
    label('영남알프스를 지켜라!', W / 2, 70, 76, '#ffe600', FONT, 'center', 10);
    label('SELECT YOUR FIGHTER', W / 2, 138, 34, '#19f5c8', NUM, 'center', 0);
    const hot0 = s.picked[0] ? pickedInfo(s.picked[0]) : tileInfo(s.cur[0]);
    const lk0 = !s.picked[0] && !allowed(s.cur[0], 0, s.mode) && s.cur[0] !== RAND_I;
    ctx.save(); ctx.translate(40 + Math.sin(s.shake[0] * 40) * 16 * s.shake[0], 0); bigFace(hot0.img, 0, 190, 600, 620, 120, false, hot0.col, lk0); ctx.restore();
    profile(hot0, 30, 850, false); label('1P', 70, 230, 48, '#ffe600', NUM, 'left', 7);
    if (s.mode === 'arcade') { const C = CHARS[BOSS]; bigFace(IMG[C.vs] || IMG[C.face], W - 640, 190, 600, 620, 120, true, C.col, false); profile(tileInfo(BOSS_I), W - 590, 850, true); label('BOSS', W - 90, 230, 40, '#ffe600', NUM, 'right', 6); }
    else { const hot1 = s.picked[1] ? pickedInfo(s.picked[1]) : tileInfo(s.cur[1]); const lk1 = !s.picked[1] && !allowed(s.cur[1], 1, s.mode) && s.cur[1] !== RAND_I;
      ctx.save(); ctx.translate(Math.sin(s.shake[1] * 40) * 16 * s.shake[1], 0); bigFace(hot1.img, W - 640, 190, 600, 620, 120, true, hot1.col, lk1, s.picked[1] && s.picked[1] === s.picked[0] ? 160 : 0); ctx.restore();
      profile(hot1, W - 590, 850, true); label('2P', W - 70, 230, 48, '#ff2f8a', NUM, 'right', 7); }
    for (let i = 0; i < TILE_N; i++) { const b = tileRect(i), t = tileInfo(i), on0 = s.cur[0] === i, on1 = s.mode === 'versus' && s.cur[1] === i, on = on0 || on1;
      const ok0 = allowed(i, 0, s.mode), ok1 = s.mode === 'versus' && allowed(i, 1, s.mode), locked = !ok0 && !ok1;
      ctx.save(); if (on) { ctx.translate(b.x + b.s / 2, b.y + b.s / 2); ctx.scale(1.08, 1.08); ctx.translate(-(b.x + b.s / 2), -(b.y + b.s / 2)); }
      sticker(() => { ctx.beginPath(); ctx.rect(b.x, b.y, b.s, b.s); }, t.col[1], on ? 10 : 6);
      if (t.img) { ctx.save(); ctx.beginPath(); ctx.rect(b.x + 4, b.y + 4, b.s - 8, b.s - 8); ctx.clip(); if (locked || (i === BOSS_I && s.mode === 'arcade')) ctx.filter = 'grayscale(1) brightness(.5)'; ctx.drawImage(t.img, b.x + 4, b.y + 4, b.s - 8, b.s - 8); ctx.restore(); }
      else if (i === RAND_I) label('?', b.x + b.s / 2, b.y + b.s / 2 - 10, 110, '#fff', NUM, 'center', 10);
      if (!READY[t.key] && i !== RAND_I) { lockIcon(b.x + b.s / 2, b.y + 52, .9); label('준비중', b.x + b.s / 2, b.y + b.s - 22, 28, '#ffe600', FONT, 'center', 6); }
      else if (i === BOSS_I && s.mode === 'arcade') { label('BOSS', b.x + b.s / 2, b.y + 40, 32, '#ff2f8a', NUM, 'center', 6); label(t.name, b.x + b.s / 2, b.y + b.s - 22, 28, '#fff', FONT, 'center', 6); }
      else label(t.name, b.x + b.s / 2, b.y + b.s - 22, 28, on ? t.col[0] : '#fff', FONT, 'center', 6);
      const bl = Math.sin(s.t * 24) > 0;
      if (on0) { ctx.lineWidth = 7; ctx.strokeStyle = s.done[0] ? '#ffe600' : bl ? '#ffe600' : '#fff'; ctx.strokeRect(b.x - 7, b.y - 7, b.s + 14, b.s + 14); label('1P', b.x + 8, b.y - 18, 32, '#ffe600', NUM, 'left', 6); }
      if (on1) { ctx.lineWidth = 7; ctx.strokeStyle = s.done[1] ? '#ff2f8a' : bl ? '#ff2f8a' : '#fff'; ctx.strokeRect(b.x - 12, b.y - 12, b.s + 24, b.s + 24); label('2P', b.x + b.s - 8, b.y - 18, 32, '#ff2f8a', NUM, 'right', 6); }
      ctx.restore(); }
    const hint = s.mode === 'arcade' ? (s.resume != null ? `${STAGES[s.resume].round} ${STAGES[s.resume].place}부터 이어서 해요! · 다른 캐릭터로 바꿔도 돼요` : '파이터를 고르세요 · 펀치 = 결정  킥 = 뒤로') : (s.done[0] && !s.done[1] ? '2P도 골라 주세요! (방향키 · 숫자1)' : '1P · 2P 각자 고르세요 · 2P는 산신령도 고를 수 있어요');
    label(hint, W / 2, 196, 30, '#fff', FONT, 'center', 5);   // 10/2: 칸이 3줄이 되어 제목 아래로
    { const hk = s.picked[0] || tileInfo(s.cur[0]).key, HC = CHARS[hk];   // 1P 캐릭터 기술 한 줄 힌트
      if (HC && READY[hk] && HC.commands) { const lines = HC.commands.map(c => `${ARROW[EASY[c.easy]]} + ${BTN_STYLE[c.btn][0]}   ${c.name}`); if (HC.rapid) lines.push(`펀치 연타   ${HC.rapid.name}`); if (HC.signature) lines.push(`필살기   ${HC.signature}`);
        const lh = 28, hgt = 54 + lines.length * lh + 18, y0 = Math.min(880, H - 6 - hgt), bw = 680;   // 10/2: 줄이 많아도 화면 안 · 긴 줄은 글씨 줄임
        ctx.save(); ctx.fillStyle = 'rgba(12,6,30,.97)'; ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, y0, bw, hgt, 18); ctx.fill(); ctx.stroke(); ctx.restore();
        label(`${HC.name} 기술`, W / 2, y0 + 24, 28, '#19f5c8', FONT, 'center', 5);
        lines.forEach((t, i) => { ctx.font = `24px ${FONT}`; const fs = Math.min(24, Math.floor(24 * (bw - 40) / Math.max(1, ctx.measureText(t).width))); label(t, W / 2, y0 + 56 + i * lh, fs, '#ffe600', FONT, 'center', 5); });
        label('자세한 기술표: 타이틀에서 ▼', W / 2, y0 + 52 + lines.length * lh, 20, '#c9b8ff', FONT, 'center', 4); } }
    for (let side = 0; side < 2; side++) if (s.done[side] && !(s.mode === 'arcade' && side === 1)) { const x = side === 0 ? 340 : W - 340; ctx.save(); ctx.translate(x, 500); ctx.rotate(-.12); label('OK!', 0, 0, 90, side ? '#ff2f8a' : '#ffe600', NUM, 'center', 12); ctx.restore(); }
    if (s.goT >= 0) { const t = s.t - s.goT, sc = t < .25 ? 3 - 2 * EASE.back(t / .25) : 1; ctx.save(); ctx.translate(W / 2, 470); ctx.rotate(-.1); ctx.scale(sc, sc); label('SELECT!', 0, 0, 120, '#ffe600', NUM, 'center', 14); ctx.restore(); }
    drawFx('screen');
  },
};
function pickedInfo(key) { const C = CHARS[key]; return { key, name: C.name, en: C.en, age: C.age, tag: C.tag, col: C.col, img: IMG[C.face] }; }

// ---------- 경기장 선택 (2인) ----------
function stageRect(i) { return { x: W / 2 - 870 + i * 590, y: 300, w: 560, h: 420 }; }
SCENES.stage = {
  enter(s) { s.sel = 0; },
  update(s) {
    for (const p of [IN.p[0], IN.p[1]]) {
      if (p.pressed.l) { s.sel = (s.sel + 2) % 3; A.sfx('move'); } if (p.pressed.r) { s.sel = (s.sel + 1) % 3; A.sfx('move'); }
      if (s.t > .3 && (p.pressed.p || p.pressed.start)) { A.sfx('select'); go('vs', { match: { mode: 'versus', stage: s.sel, p1: s.p1, p2: s.p2, ai: [null, null] } }); return; }
      if (p.pressed.k) { A.sfx('back'); go('select', { mode: 'versus', keep: true }); return; }
    }
    if (IN.idleMs() > idleMs()) go('title');
  },
  click(x, y) { for (let i = 0; i < 3; i++) { const r = stageRect(i); if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { if (scene.sel === i) { A.sfx('select'); go('vs', { match: { mode: 'versus', stage: i, p1: scene.p1, p2: scene.p2, ai: [null, null] } }); } else { scene.sel = i; A.sfx('move'); } } } },
  draw(s) {
    menuBg(s.t); label('경기장을 고르세요', W / 2, 140, 84, '#ffe600', FONT, 'center', 12); label('SELECT STAGE', W / 2, 220, 34, '#19f5c8', NUM, 'center', 0);
    STAGES.forEach((st, i) => { const r = stageRect(i), on = s.sel === i, img = IMG['thumb' + i];
      ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2); const sc = on ? 1.06 : .94; ctx.scale(sc, sc); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2)); ctx.globalAlpha = on ? 1 : .6;
      sticker(() => { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 24); }, '#140828', 12);
      if (img) { ctx.save(); ctx.beginPath(); ctx.roundRect(r.x + 8, r.y + 8, r.w - 16, r.h - 110, 18); ctx.clip(); const ih = (r.w - 16) * img.height / img.width; ctx.drawImage(img, r.x + 8, r.y + 8, r.w - 16, ih); ctx.restore(); }
      label(st.place, r.x + r.w / 2, r.y + r.h - 55, 64, on ? '#ffe600' : '#fff', FONT, 'center', 9); ctx.restore();
      if (on) { ctx.lineWidth = 8; ctx.strokeStyle = Math.sin(s.t * 20) > 0 ? '#ffe600' : '#ff2f8a'; ctx.strokeRect(r.x - 30, r.y - 30, r.w + 60, r.h + 60); } });
    label('← → 로 고르고 펀치로 결정 · 킥 = 뒤로', W / 2, 1010, 38, '#fff', FONT, 'center', 6);
  },
};

// ---------- VS ----------
SCENES.vs = {
  enter(s) { A.bgm('select'); s.played = false; },
  update(s) {
    if (s.t > .3 && !s.played) { s.played = true; A.sfx('vs'); }
    const skip = s.t > .9 && IN.anyPressed;
    if (s.t > 2.8 || skip) { const m = s.match; go('fight', { match: m }); }
  },
  click() { if (scene.t > .9) go('fight', { match: scene.match }); },
  draw(s) {
    const m = s.match, C0 = CHARS[m.p1], C1 = CHARS[m.p2], t = s.t, inP = EASE.out(Math.min(1, t / .3)), sl = 160;
    menuBg(t);
    for (const [side, C, bgc] of [[0, C0, '#7b2cff'], [1, C1, '#ff2f8a']]) {
      ctx.save(); ctx.beginPath(); if (side === 0) { ctx.moveTo(0, 0); ctx.lineTo(W / 2 + sl, 0); ctx.lineTo(W / 2 - sl, H); ctx.lineTo(0, H); } else { ctx.moveTo(W / 2 + sl, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W / 2 - sl, H); } ctx.closePath(); ctx.clip();
      ctx.translate((side ? 1 : -1) * (1 - inP) * 900, 0); ctx.fillStyle = bgc; ctx.fillRect(-900, 0, W + 1800, H);
      ctx.fillStyle = 'rgba(255,255,255,.13)'; for (let y = 0; y < H; y += 40) for (let x = -900 + (y / 40 % 2) * 20; x < W + 900; x += 40) { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); }   // 10/2 물방울 무늬 판넬
      const img = IMG[C.vs] || IMG[C.fightCut] || IMG[C.face]; const mirror = side === 0 ? C.facing !== 1 : C.facing !== -1;   // 10/2: 배경 뺀 그림(누끼) 먼저
      if (img) { const sc = Math.max(H / img.height, W * .66 / img.width) * (1 + Math.min(t, 3) * .02), cx = side ? W * .76 : W * .24;
        ctx.save(); if (side === 1 && m.p1 === m.p2) ctx.filter = 'hue-rotate(160deg)'; ctx.translate(cx, H * .5); if (mirror && C.vs) ctx.scale(-1, 1); ctx.drawImage(img, -img.width * sc / 2, -img.height * sc * .42, img.width * sc, img.height * sc); ctx.restore(); }
      ctx.restore(); }
    ctx.lineWidth = 24; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(W / 2 + sl, 0); ctx.lineTo(W / 2 - sl, H); ctx.stroke(); ctx.lineWidth = 10; ctx.strokeStyle = '#ffe600'; ctx.stroke();
    profile(pickedInfo(m.p1), 40 - (1 - inP) * 700, H - 210, false); profile(pickedInfo(m.p2), W - 600 + (1 - inP) * 700, 60, true);
    const vsS = t < .3 ? 0 : t < .55 ? 3 - 2 * EASE.back((t - .3) / .25) : 1 + Math.sin(t * 8) * .03;
    if (vsS) { ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-.1); ctx.scale(vsS, vsS); label('VS', 0, 0, 300, '#ffe600', NUM, 'center', 26); ctx.restore(); }
    const st = STAGES[m.stage]; if (t > .8 && !Q.has('novsround')) label(m.mode === 'versus' ? `${st.place}` : `${st.round} · ${st.place}`, W / 2, H - 70, 50, '#fff', FONT, 'center', 8);
    if (m.mode === 'arcade' && t > .8) { const lv = clamp((m.ai && m.ai[1]) || STAGES[m.stage].ai, 1, 3) - 1; label(['쉬움', '보통', '어려움'][lv], W / 2, 60, 40, ['#9dff5a', '#ffe600', '#ff5a6a'][lv], FONT, 'center', 7); }
    if (t > 2.4) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, (t - 2.4) / .4)})`; ctx.fillRect(0, 0, W, H); }
  },
};

// ---------- 대전 ----------
SCENES.fight = {
  enter(s) { startMatch(s.match); },
  update(s) {
    if (G.mode === 'demo' && s.t > .3 && IN.anyPressed) { go('title'); return; }
    updateMatch();
  },
  draw(s) {
    drawWorld();
    if (G && G.mode === 'demo') { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H - 150, W, 70); ctx.restore();
      if (blink(1.2)) label('DEMO PLAY · 아무 버튼이나 누르면 시작!', W / 2, H - 115, 46, '#ffe600', FONT, 'center', 7); }
  },
};
function startDemo() {
  const players = Object.keys(CHARS).filter(k => READY[k] && !CHARS[k].boss);
  const p1 = pick(players.length ? players : [BOSS]);
  const stage = Math.floor(Math.random() * 3);
  go('fight', { match: { mode: 'demo', stage, p1, p2: BOSS, ai: [2, 2] } });
  IN.lastInput = IN.now();
}

// ---------- 기술표 ----------
const ARROW = { 6: '→', 4: '←', 2: '↓', 3: '↘', 1: '↙', 8: '↑' };
const BTN_STYLE = { p: ['펀치', '#ffe600', '#000'], k: ['킥', '#19f5c8', '#000'], s: ['필살', '#ff2f8a', '#fff'] };
function chip(x, y, it, sz = 1) { // it: 'p'|'k'|'s' | 화살표 문자 | '+' | '▶' | 글자
  ctx.save();
  if (BTN_STYLE[it]) { const [t, bg, fg] = BTN_STYLE[it]; ctx.font = `${30 * sz}px ${FONT}`; const w = ctx.measureText(t).width + 30 * sz, h = 48 * sz;
    ctx.fillStyle = bg; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + w / 2, y + 2); ctx.restore(); return x + w + 8 * sz; }
  if ('→←↓↘↙↑'.includes(it)) { const s = 48 * sz; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(x, y - s / 2, s, s, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = `700 ${34 * sz}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it, x + s / 2, y + 2); ctx.restore(); return x + s + 8 * sz; }
  ctx.font = `${30 * sz}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.strokeText(it, x, y + 2); ctx.fillStyle = it === '+' || it === '▶' ? '#ffe600' : '#fff'; ctx.fillText(it, x, y + 2);
  const w = ctx.measureText(it).width; ctx.restore(); return x + w + 8 * sz;
}
function chips(x, y, arr, sz = 1) { for (const it of arr) x = chip(x, y, it, sz); return x; }
function comboList(C) { // moves 의 chain · links 를 따라가며 3단까지 연계 목록 만들기
  const out = [], M = C.moves;
  const walk = (key, path, btns) => { const m = M[key]; if (!m) return; const nx = []; if (m.chain) nx.push([m.chain, btns[btns.length - 1]]); for (const [b, k] of Object.entries(m.links || {})) nx.push([k, b]);
    if (!nx.length || path.length >= 3) { if (path.length >= 2) out.push({ btns: [...btns], name: m.comboName || '' }); return; }
    for (const [k, b] of nx) walk(k, [...path, k], [...btns, b]); if (path.length >= 2 && m.comboName) out.push({ btns: [...btns], name: m.comboName }); };
  walk('punch', ['punch'], ['p']); walk('kick', ['kick'], ['k']);
  const seen = new Set(); return out.filter(c => { const k = c.btns.join(''); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.btns.length - a.btns.length).slice(0, 4);
}
function mlChars() { return Object.keys(CHARS).filter(k => READY[k]); }
SCENES.movelist = {
  enter(s) { const ks = mlChars(); s.i = Math.max(0, ks.indexOf(s.key || ks[0])); A.bgm('select'); },
  update(s) {
    const ks = mlChars(), p = IN.merged();
    if (p.pressed.l) { s.i = (s.i + ks.length - 1) % ks.length; A.sfx('move'); } if (p.pressed.r) { s.i = (s.i + 1) % ks.length; A.sfx('move'); }
    if (s.t > .4 && (p.pressed.p || p.pressed.k || p.pressed.s || p.pressed.start)) { A.sfx('back'); go(s.back || 'title', s.back === 'mode' ? { sel: 0 } : {}); return; }
    if (IN.idleMs() > idleMs() * 1.5) go('title');
  },
  click(x, y) { const ks = mlChars(), s = scene;
    for (let i = 0; i < ks.length; i++) { const r = mlTab(i, ks.length); if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { s.i = i; A.sfx('move'); return; } }
    if (s.t > .4) { A.sfx('back'); go(s.back || 'title', s.back === 'mode' ? { sel: 0 } : {}); } },
  draw(s) {
    menuBg(s.t); const ks = mlChars(), key = ks[s.i], C = CHARS[key];
    label('기술표', W / 2, 62, 76, '#ffe600', FONT, 'center', 11); label('MOVE LIST', W / 2, 122, 28, '#19f5c8', NUM, 'center', 0);
    ks.forEach((k, i) => { const r = mlTab(i, ks.length), on = i === s.i, c = CHARS[k];
      sticker(() => { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 16); }, on ? c.col[1] : '#241238', on ? 9 : 5);
      const img = IMG[c.face]; if (img) { ctx.save(); ctx.beginPath(); ctx.roundRect(r.x + 8, r.y + 8, r.h - 16, r.h - 16, 10); ctx.clip(); ctx.drawImage(img, r.x + 8, r.y + 8, r.h - 16, r.h - 16); ctx.restore(); }
      label(c.name, r.x + r.h + (r.w - r.h) / 2 - 6, r.y + r.h / 2 + 2, 40, on ? c.col[0] : '#fff', FONT, 'center', 6); });
    // 왼쪽: 얼굴
    bigFace(IMG[C.face], 30, 250, 470, 560, 90, false, C.col, false);
    label(C.name, 250, 860, 70, C.col[0], FONT, 'center', 10); label(C.tag, 250, 930, 34, '#fff', FONT, 'center', 6);
    // 오른쪽: 표 (배경 띠가 글자를 가리지 않게 어두운 판)
    ctx.save(); ctx.fillStyle = 'rgba(12,6,30,.84)'; ctx.beginPath(); ctx.roundRect(535, 245, 1360, 760, 24); ctx.fill(); ctx.restore();
    const X1 = 560, X2 = 1240; let y = 280;
    const head = (t, x, yy, col = '#19f5c8') => { label(t, x, yy, 40, col, FONT, 'left', 7); ctx.fillStyle = col; ctx.fillRect(x, yy + 26, 600, 4); };
    head('기본기', X1, y); y += 72;
    const basics = [['펀치 · 킥', ['p', 'k']], ['앉아 펀치', ['↓', '+', 'p']], ['앉아 킥', ['↓', '+', 'k']], ['점프 공격', ['↑', '▶', 'p']], ['막기', ['←', '누르고 있기']]];
    for (const [t, a] of basics) { label(t, X1 + 10, y, 34, '#fff', FONT, 'left', 5); chips(X1 + 230, y, a, .9); y += 60; }
    y += 18; head('콤보 (맞았을 때 이어서 누르기)', X1, y, '#ffe600'); y += 72;
    for (const c of comboList(C)) { const arr = []; c.btns.forEach((b, i) => { if (i) arr.push('▶'); arr.push(b); }); const ex = chips(X1 + 10, y, arr, .9); if (c.name && c.btns.length >= 3) label(c.name, ex + 10, y, 30, '#ffe600', FONT, 'left', 5); y += 60; }
    if (C.rapid) { chips(X1 + 10, y, ['p', 'p', 'p', '빠르게!'], .9); label(C.rapid.name, X1 + 380, y, 30, '#ffe600', FONT, 'left', 5); y += 60; }
    chips(X1 + 10, y, ['점프 공격', '▶', '착지', '▶', 'p'], .9); y += 60;
    let y2 = 280;
    head('기술 (방향 + 버튼만 눌러도 돼요)', X2, y2, '#ff8ad0'); y2 += 76;
    for (const c of C.commands || []) {
      label(c.name, X2 + 10, y2, 40, '#fff', FONT, 'left', 6);
      const ex = chips(X2 + 300, y2, [ARROW[EASY[c.easy]], '+', c.btn], 1);
      label(`또는 ${[...(c.motion || '')].map(d => ARROW[+d]).join('')} + ${BTN_STYLE[c.btn][0]}`, ex + 14, y2, 26, '#c9b8ff', FONT, 'left', 4);
      if (c.desc) label(c.desc, X2 + 14, y2 + 44, 28, '#ffe600', FONT, 'left', 4);
      y2 += (C.commands.length > 3 ? 90 : 104); }
    y2 += 6; head('필살기 (SUPER MAX 일 때)', X2, y2, '#ff2f8a'); y2 += 70;
    if (C.signature) { label(C.signature, X2 + 10, y2, 30, '#ffe600', FONT, 'left', 5); y2 += 48; }   // 대표 필살기 한 줄 설명
    C.specials.forEach((sp, i) => { chips(X2 + 10, y2, ['s'], .9); label(`${['1판', '2판', '3판'][i]}  ${sp.name}`, X2 + 120, y2, 32, '#fff', FONT, 'left', 5); y2 += 50; });
    chips(X2 + 10, y2, ['콤보가 맞는 중에', 's', '=', '필살 캔슬!'], .85);
    mlFooter();
  },
};
function mlFooter() {   // 기술표 아래·왼쪽 위 안내 (대각선 입력 설명 포함)
  label('◀ ▶ 캐릭터 바꾸기 · 공격 버튼 = 돌아가기', 40, 40, 26, '#fff', FONT, 'left', 5);
  label('→ = 상대 쪽 · ← = 뒤쪽 · M = 노래 바꾸기', 40, 76, 26, '#c9b8ff', FONT, 'left', 5);
  const diag = IN.touchOn ? '대각선(↘ 등) = 방향 패드를 대각선으로 누르기  (예: 오른쪽 보고 있을 때 ↘ = ▶와 ▼ 사이)'
    : '대각선(↘ 등) = 두 방향키를 같이 누르기  (예: 오른쪽 보고 있을 때 ↘ = D+S)';
  label(diag, W / 2, 1042, 32, '#ffe600', FONT, 'center', 6);
}
function mlTab(i, n) { const w = 270, g = 16, x0 = W / 2 - (n * w + (n - 1) * g) / 2; return { x: x0 + i * (w + g), y: 150, w, h: 80 }; }

// ---------- 졌을 때 · 경기 끝난 뒤 메뉴 (1인: 다시하기/캐릭터 다시 고르기/처음으로 · 2인: 다시 붙기/…) ----------
const AFTER_SEC = 15;   // 아무도 안 고르면 이 시간 뒤 타이틀로 (전시용)
function afterItems(s) {
  const m = s.match, st = STAGES[m.stage];
  if (m.mode === 'arcade') return [
    { t: '다시하기', d: `같은 캐릭터로 ${st.round} ${st.place} 다시!`, col: THEME[0] },
    { t: '캐릭터 다시 고르기', d: `다른 캐릭터로 ${st.round}부터 이어서`, col: THEME[1] },
    { t: '처음으로', d: '타이틀 화면으로 돌아가요', col: ['#ffffff', '#9a9ab0', '#3a3a58'] },
  ];
  return [
    { t: '다시 붙기', d: `같은 캐릭터 · ${st.place}에서 한 판 더!`, col: THEME[0] },
    { t: '캐릭터 다시 고르기', d: '1P · 2P 둘 다 새로 골라요', col: THEME[1] },
    { t: '처음으로', d: '타이틀 화면으로 돌아가요', col: ['#ffffff', '#9a9ab0', '#3a3a58'] },
  ];
}
function afterRect(i) { return { x: W / 2 - 560, y: 372 + i * 172, w: 1000, h: 146 }; }
SCENES.continue = {
  enter(s) { s.sel = 0; s.left = AFTER_SEC; s.last = AFTER_SEC; s.over = -1; s.tick = 0; A.bgmStop(); A.bgm('select'); },
  update(s) {
    if (s.over >= 0) { if (s.t - s.over > 2.5) go('title'); return; }
    s.tick += DT;
    const n = Math.max(0, Math.ceil(AFTER_SEC - s.tick)); if (n !== s.last) { s.last = n; if (n <= 5) A.sfx('count'); } s.left = n;
    const players = s.match.mode === 'arcade' ? [IN.merged()] : [IN.p[0], IN.p[1]];
    for (const p of players) {
      if (p.pressed.u) { s.sel = (s.sel + 2) % 3; A.sfx('move'); s.tick = Math.min(s.tick, AFTER_SEC - 8); }   // 움직이면 최소 8초는 남겨 둠
      if (p.pressed.d) { s.sel = (s.sel + 1) % 3; A.sfx('move'); s.tick = Math.min(s.tick, AFTER_SEC - 8); }
      if (s.t > .8 && (p.pressed.p || p.pressed.k || p.pressed.s || p.pressed.start)) { this.choose(s, s.sel); return; }
    }
    if (s.tick >= AFTER_SEC) {
      if (s.match.mode === 'arcade') { s.over = s.t; A.bgmStop(); } else go('title');
    }
  },
  choose(s, i) {
    const m = s.match;
    if (i === 0) { A.sfx('select'); if (m.mode === 'arcade' && RUN) RUN.cont++; go('vs', { match: Object.assign({}, m) }); }
    else if (i === 1) { A.sfx('select'); go('select', m.mode === 'arcade' ? { mode: 'arcade', keep: true, resume: m.stage, prevChar: m.p1 } : { mode: 'versus', keep: true }); }
    else { A.sfx('back'); go('title'); }
  },
  click(x, y) { const s = scene; if (s.over >= 0 || s.t < .5) return;
    for (let i = 0; i < 3; i++) { const r = afterRect(i); if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { s.sel = i; this.choose(s, i); return; } } },
  draw(s) {
    if (G) drawWorld(); ctx.fillStyle = 'rgba(8,4,24,.8)'; ctx.fillRect(0, 0, W, H);
    if (s.over >= 0) { label('GAME OVER', W / 2, H / 2, 230, '#ff2030', NUM, 'center', 18); label('다음에 또 도전해요!', W / 2, H / 2 + 170, 60, '#fff', FONT, 'center', 8); return; }
    const m = s.match, st = STAGES[m.stage], inT = EASE.out(Math.min(1, s.t / .35));
    // 머리글
    if (m.mode === 'arcade') {
      label('CONTINUE?', W / 2, 120, 150, '#ffe600', NUM, 'center', 14);
      label(`아쉽다! ${st.round} ${st.place}에서 졌어요. 어떻게 할까요?`, W / 2, 262, 50, '#fff', FONT, 'center', 8);
    } else {
      const w = s.win, txt = w === 0 ? '1P 승리!' : w === 1 ? '2P 승리!' : '무승부!';
      label(txt, W / 2, 130, 140, w === 1 ? '#ff2f8a' : '#ffe600', FONT, 'center', 14);
      label('한 판 더 할까요?', W / 2, 262, 54, '#fff', FONT, 'center', 8);
    }
    // 선택지
    afterItems(s).forEach((it, i) => { const r = afterRect(i), on = s.sel === i, dx = (1 - inT) * (i % 2 ? 1 : -1) * 600;
      const sc = on ? 1.04 + Math.sin(s.t * 6) * .008 : .96;
      ctx.save(); ctx.translate(r.x + r.w / 2 + dx, r.y + r.h / 2); ctx.scale(sc, sc); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2)); ctx.globalAlpha = on ? 1 : .72;
      sticker(() => slantPanel(r.x, r.y, r.w, r.h, 40, false), on ? it.col[2] : '#241238', on ? 12 : 8);
      // 번호 동그라미
      ctx.fillStyle = on ? it.col[0] : '#3a2a58'; ctx.strokeStyle = '#000'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(r.x + 80, r.y + r.h / 2, 48, 0, 7); ctx.fill(); ctx.stroke();
      label(String(i + 1), r.x + 80, r.y + r.h / 2 + 3, 64, on ? '#000' : '#fff', NUM, 'center', 0);
      label(it.t, r.x + 160, r.y + 52, 70, on ? it.col[0] : '#fff', FONT, 'left', 10);
      label(it.d, r.x + 162, r.y + 112, 34, '#fff', FONT, 'left', 6);
      ctx.restore();
      if (on) { const ax = r.x - 50 + Math.sin(s.t * 8) * 8, ay = r.y + r.h / 2; ctx.fillStyle = '#ffe600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(ax - 30, ay - 32); ctx.lineTo(ax + 26, ay); ctx.lineTo(ax - 30, ay + 32); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    });
    // 카운트다운 (오른쪽)
    const cx = 1715, cy = 540, R = 108, frac = Math.max(0, (AFTER_SEC - s.tick) / AFTER_SEC), warn = s.left <= 5;
    label('처음으로 가기까지', cx, cy - R - 44, 32, '#fff', FONT, 'center', 6);
    ctx.save(); ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = warn ? '#ff4040' : '#19f5c8'; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke(); ctx.restore();
    const ph = s.tick % 1, nsc = warn ? 1.25 - .25 * EASE.out(Math.min(1, ph * 3)) : 1;
    ctx.save(); ctx.translate(cx, cy + 4); ctx.scale(nsc, nsc); label(String(s.left), 0, 0, 120, warn ? '#ff4040' : '#fff', NUM, 'center', 12); ctx.restore();
    label('초', cx, cy + R + 44, 36, '#fff', FONT, 'center', 6);
    if (m.mode === 'arcade' && RUN) label(`기록 ${fmtTime(RUN.time)}`, cx, cy + R + 100, 26, '#ffe600', FONT, 'center', 5);
    label('▲ ▼ 로 고르고  펀치(F · A버튼)로 결정  ·  화면을 눌러도 돼요', W / 2, 1020, 38, '#fff', FONT, 'center', 7);
  },
};

// ---------- 클리어 시간 순위 (TOP 10) ----------
const RANK_KEY = 'pokto_ranking_v1', RANK_N = 10;
let RUN = null;                  // 1인 도전 기록 { time: 싸운 시간 합(초), cont: 이어하기 횟수 }
function fmtTime(t) { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; }
// 판 수 설정(3·2·1판)마다 순위표가 따로 (예전 기록은 3판 기록으로 봄). 저장은 한 칸에 판 수별로 최대 10개씩
function rankAll() { try { const a = JSON.parse(localStorage.getItem(RANK_KEY) || '[]'); return Array.isArray(a) ? a.filter(r => r && typeof r.time === 'number' && Number.isFinite(r.time)) : []; } catch (e) { return []; } }
function rankLoad() { return rankAll().filter(r => (r.rounds || 3) === SET.rounds).sort((p, q) => p.time - q.time).slice(0, RANK_N); }
function rankSave(list) { try { const keep = []; for (const n of [3, 2, 1]) keep.push(...list.filter(r => (r.rounds || 3) === n).sort((p, q) => p.time - q.time).slice(0, RANK_N)); localStorage.setItem(RANK_KEY, JSON.stringify(keep)); } catch (e) {} }
function rankPlace(time) { const l = rankLoad(); let i = 0; while (i < l.length && l[i].time <= time) i++; return i < RANK_N ? i : -1; }   // 들어갈 자리(0부터), 못 들면 -1
function rankAdd(rec) { rec.rounds = SET.rounds; const l = rankAll(); l.push(rec); rankSave(l); return rankLoad().indexOf(rec); }
function rankClear() { try { localStorage.removeItem(RANK_KEY); } catch (e) {} }
if (Q.has('resetRanking')) rankClear();
function faceBox(key, x, y, s) {
  const C = CHARS[key], img = C && IMG[C.face];
  ctx.save(); ctx.fillStyle = C ? C.col[1] : '#333'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.beginPath(); ctx.rect(x, y, s, s); ctx.fill();
  if (img) { ctx.save(); ctx.clip(); ctx.drawImage(img, x, y, s, s); ctx.restore(); } ctx.stroke(); ctx.restore();
}

// 이름 입력 (영문 3글자)
const NAME_CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function entryRect(i) { return { x: W / 2 - 330 + i * 230, y: 430, w: 200, h: 240 }; }
SCENES.entry = {
  enter(s) { s.idx = [0, 0, 0]; s.slot = 0; s.done = -1; s.lastIn = 0; A.bgm('select'); A.sfx('sparkle'); },
  update(s) {
    if (s.done >= 0) { if (s.t - s.done > .9) go('ranking', { hi: s.hiRec, from: 'entry' }); return; }
    const p = IN.merged();
    if (p.pressed.u) this.bump(s, 1); if (p.pressed.d) this.bump(s, -1);
    if (p.pressed.r && s.slot < 2) { s.slot++; A.sfx('move'); } if (p.pressed.l && s.slot > 0) { s.slot--; A.sfx('move'); }
    if (s.t > .6 && (p.pressed.p || p.pressed.start || p.pressed.s)) this.ok(s);
    if (s.t > .6 && p.pressed.k && s.slot > 0) { s.slot--; A.sfx('back'); }
    if (p.any) s.lastIn = s.t;
    if (s.t - s.lastIn > 30) this.save(s);                    // 30초 동안 손 안 대면 지금 글자로 저장
  },
  bump(s, d) { s.idx[s.slot] = (s.idx[s.slot] + d + NAME_CH.length) % NAME_CH.length; A.sfx('move'); s.lastIn = s.t; },
  ok(s) { A.sfx('select'); if (s.slot < 2) s.slot++; else this.save(s); },
  save(s) {
    if (s.done >= 0) return;
    const rec = { name: s.idx.map(i => NAME_CH[i]).join(''), key: s.p1, time: Math.round(s.time * 100) / 100, cont: s.cont, date: new Date().toISOString().slice(0, 10) };
    rankAdd(rec); s.hiRec = rec; s.done = s.t; A.voice('a_win');
  },
  click(x, y) { const s = scene; if (s.done >= 0) return;
    if (y > 740 && y < 860 && Math.abs(x - W / 2) < 260) { s.slot = 2; this.save(s); A.sfx('select'); return; }       // [확정] 버튼
    for (let i = 0; i < 3; i++) { const r = entryRect(i); if (x > r.x && x < r.x + r.w) {
      if (y > r.y - 110 && y < r.y) { s.slot = i; this.bump(s, 1); } else if (y > r.y + r.h && y < r.y + r.h + 110) { s.slot = i; this.bump(s, -1); } else if (y >= r.y && y <= r.y + r.h) { s.slot = i; A.sfx('move'); } } } },
  draw(s) {
    menuBg(s.t);
    label('NEW RECORD!', W / 2, 110, 140, '#ffe600', NUM, 'center', 14);
    label(`${s.place + 1}위에 들었어요!  기록 ${fmtTime(s.time)}`, W / 2, 240, 60, '#19f5c8', FONT, 'center', 9);
    label('이름(영어 3글자)을 정해 주세요', W / 2, 320, 44, '#fff', FONT, 'center', 7);
    faceBox(s.p1, W / 2 - 700, 450, 200); label(CHARS[s.p1] ? CHARS[s.p1].name : '', W / 2 - 600, 700, 40, '#fff', FONT, 'center', 7);
    for (let i = 0; i < 3; i++) { const r = entryRect(i), on = i === s.slot && s.done < 0;
      sticker(() => { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 20); }, on ? '#7b2cff' : '#241238', on ? 12 : 8);
      label(NAME_CH[s.idx[i]], r.x + r.w / 2, r.y + r.h / 2 + 8, 180, on ? '#ffe600' : '#fff', NUM, 'center', 14);
      if (on) { const b = Math.sin(s.t * 8) * 6; ctx.fillStyle = '#ffe600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(r.x + r.w / 2 - 44, r.y - 30 - b); ctx.lineTo(r.x + r.w / 2 + 44, r.y - 30 - b); ctx.lineTo(r.x + r.w / 2, r.y - 80 - b); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r.x + r.w / 2 - 44, r.y + r.h + 30 + b); ctx.lineTo(r.x + r.w / 2 + 44, r.y + r.h + 30 + b); ctx.lineTo(r.x + r.w / 2, r.y + r.h + 80 + b); ctx.closePath(); ctx.stroke(); ctx.fill(); } }
    sticker(() => { ctx.beginPath(); ctx.roundRect(W / 2 - 250, 760, 500, 96, 20); }, s.slot === 2 ? '#ff2f8a' : '#3a2a58', 8);
    label('확정!', W / 2, 810, 60, '#fff', FONT, 'center', 8);
    if (s.done >= 0) label('저장했어요!', W / 2, 950, 70, '#ffe600', FONT, 'center', 10);
    else label('▲ ▼ 글자 바꾸기 · 펀치 = 다음 글자 / 확정 · 킥 = 앞 글자로', W / 2, 1000, 38, '#fff', FONT, 'center', 7);
  },
};

// 순위표
function rankRow(i) { return { x: W / 2 - 700, y: 250 + i * 74, w: 1400, h: 66 }; }
SCENES.ranking = {
  enter(s) { s.list = rankLoad(); s.hold = 0; s.cleared = -1; A.bgm('select'); IN.lastInput = IN.now(); },
  update(s) {
    const p = IN.merged();
    // 숨은 초기화: 펀치+킥+필살기를 5초 동안 함께 누르고 있기
    if (p.p && p.k && p.s) { s.hold += DT; if (s.hold >= 5 && s.cleared < 0) { rankClear(); s.list = []; s.cleared = s.t; A.sfx('deny'); } } else s.hold = 0;
    if (s.hold > .3) { s.pend = null; return; }
    const dur = s.from === 'entry' ? 12 : s.from === 'miss' ? 9 : 8;
    if (s.t > dur) { go('title'); return; }
    if (s.t > 1 && IN.anyPressed && s.pend == null) s.pend = s.t;          // 눌림 → 0.4초 안에 세 버튼이 다 안 눌리면 타이틀로
    if (s.pend != null && s.t - s.pend > .4) go('title');
  },
  click() { if (scene.t > 1) go('title'); },
  draw(s) {
    menuBg(s.t);
    label('명예의 전당', W / 2, 88, 96, '#ffe600', FONT, 'center', 12);
    label(SET.rounds === 3 ? 'BEST CLEAR TIME · TOP 10' : `BEST CLEAR TIME · TOP 10 · ${SET.rounds} ROUND${SET.rounds > 1 ? 'S' : ''}`, W / 2, 168, 34, '#19f5c8', NUM, 'center', 0);
    const hx = [W / 2 - 610, W / 2 - 420, W / 2 - 150, W / 2 + 470];   // 10/2: 이어하기 칸 뺌
    label('순위', hx[0], 222, 30, '#fff', FONT, 'center', 5); label('이름', hx[1], 222, 30, '#fff', FONT, 'center', 5); label('캐릭터', hx[2], 222, 30, '#fff', FONT, 'center', 5);
    label('기록', hx[3], 222, 30, '#fff', FONT, 'center', 5);
    if (!s.list.length) label('아직 기록이 없어요! 첫 번째 주인공이 되어 보세요', W / 2, 560, 54, '#fff', FONT, 'center', 8);
    s.list.forEach((r, i) => { const b = rankRow(i), hi = s.hi && r.name === s.hi.name && r.time === s.hi.time && r.date === s.hi.date, inT = EASE.out(Math.min(1, Math.max(0, (s.t - i * .06) / .3)));
      ctx.save(); ctx.globalAlpha = inT; ctx.translate((1 - inT) * 200, 0);
      const medal = ['#ffd23f', '#d8e0ea', '#e0955a'][i];
      ctx.fillStyle = hi ? (Math.sin(s.t * 10) > 0 ? '#7b2cff' : '#ff2f8a') : i % 2 ? 'rgba(20,8,40,.82)' : 'rgba(36,18,56,.82)'; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 14); ctx.fill();
      if (medal) { ctx.lineWidth = 4; ctx.strokeStyle = medal; ctx.stroke(); }
      label(`${i + 1}위`, hx[0], b.y + b.h / 2 + 2, 42, medal || '#fff', FONT, 'center', 6);
      label(r.name || '???', hx[1], b.y + b.h / 2 + 2, 50, '#fff', NUM, 'center', 6);
      faceBox(r.key, hx[2] - 150, b.y + 5, 56); label(CHARS[r.key] ? CHARS[r.key].name : '?', hx[2] - 76, b.y + b.h / 2 + 2, 36, '#fff', FONT, 'left', 5);
      label(fmtTime(r.time), hx[3], b.y + b.h / 2 + 2, 50, hi ? '#fff' : '#ffe600', NUM, 'center', 6);
      ctx.restore(); });
    if (s.from === 'miss' && s.mine) label(`내 기록 ${fmtTime(s.mine)} — 아쉽게 10위 밖!` + (s.list[0] ? `  1등까지 ${(s.mine - s.list[0].time).toFixed(1)}초!` : ' 다음엔 더 빨리!'), W / 2, 1030, 40, '#19f5c8', FONT, 'center', 7);
    else if (s.from === 'attract' && blink(1.2)) label('아무 버튼이나 누르면 시작!', W / 2, 1030, 46, '#ffe600', FONT, 'center', 7);
    if (s.hold > .3 && s.cleared < 0) label(`기록 지우는 중… ${Math.ceil(5 - s.hold)}`, W / 2, 1030, 44, '#ff4040', FONT, 'center', 7);
    if (s.cleared >= 0) label('순위 기록을 모두 지웠어요', W / 2, 560, 60, '#ff4040', FONT, 'center', 9);
  },
};
function afterEnding(p1) {   // 엔딩 뒤: 10위 안이면 이름 입력, 아니면 순위표 → 타이틀
  const r = RUN; RUN = null;
  if (!r || !(r.time > 0)) return go('title');
  const place = rankPlace(r.time);
  if (place >= 0) return go('entry', { p1, time: r.time, cont: r.cont, place });
  return go('ranking', { from: 'miss', mine: r.time });
}

// ---------- 엔딩 ----------
SCENES.ending = {
  enter(s) {
    resetFx();
    const p = newFighter(s.p1, 0, 720), b = newFighter(BOSS, 1, 1320);
    G = { mode: 'ending', stage: 2, f: [p, b], proj: [], phase: 'script', timer: 0, hitstop: 0, freeze: 0 };
    setState(p, 'idle', P(p).idle); setState(b, 'lose', P(b).lose); b.y = GROUND; A.bgmStop();
    const ans = p.C.endingAnswer || { text: '비밀이에요!' };
    later(.6, () => { say(b, '내가 졌다. 허허허', 1.9); A.voice('s_lose'); });
    later(2.7, () => { say(b, '근데 너, 몇 살이냐?', 2.1); A.voice('s_age'); });
    later(4.9, () => { say(p, ans.text, 1.9); A.voice(ans.voice); p.pose = P(p).taunt || P(p).win; p.sy = .9; tw(p, { sy: 1 }, .35, 'back'); });
    later(7.0, () => { tw(ex, { sun: 1 }, 3.2, 'io'); A.sfx('sparkle'); say(b, '허허, 해가 뜨는구나.', 2.2); A.voice('s_sun'); ex.burstCol = ['#ffd6f5', '#9fe8ff']; });
    later(9.4, () => { setState(p, 'win', P(p).win); A.voice(p.C.voices.win); text('YOU WIN', { size: 200, life: 2.6, y: 330, col: '#ffd23f', font: NUM }); A.voice('a_win'); A.bgm('select'); });
    later(11.6, () => { text('영남알프스를 지켰다!', { size: 130, life: 3.2, y: 330, col: '#19f5c8', stroke: '#1a0830' }); A.sfx('sparkle'); });
    later(15.2, () => text('THANK YOU FOR PLAYING', { size: 80, life: 3, y: 520, col: '#ffffff', stroke: '#7b2cff', font: NUM }));
  },
  update(s) {
    T += DT; RT += DT; runQueue(); stepTweens(); for (const f of G.f) { f.st++; }
    fx = fx.filter(fxAlive); cam.shake *= .88;
    if (s.t > 18.5 || (s.t > 8 && IN.anyPressed)) afterEnding(s.p1);   // 10위 안이면 이름 입력 → 순위표
  },
  draw() { drawWorld(); },
};

// =====================================================================
//  메인 루프 (고정 60fps 갱신)
// =====================================================================
let acc = 0, last = performance.now(), fpsN = 0, fpsT = 0, fps = 60;
function step() {
  IN.poll();
  if (IN.anyPressed && !A.ready()) A.unlock();   // 게임패드만 쓰는 경우에도 소리 켜기 (키오스크 옵션 필요)
  const S = SCENES[scene.name];
  scene.t += DT;
  if (scene.name !== 'fight' && scene.name !== 'ending') { T += DT; RT += DT; runQueue(); stepTweens(); fx = fx.filter(fxAlive); }
  if (S && S.update) S.update(scene);
}
// ---------- 점검용 오래 돌리기 (?soak=배속, 예: ?soak=200 → 한 화면마다 200프레임씩 = 200배 빠르게) ----------
//  무입력 타이머도 게임 시간으로 셈. ?soakbot=1 이면 가상 관람객이 아무렇게나 눌렀다 쉬었다 함 (쉬는 동안 데모 → 순위표 → 타이틀이 돔)
const SOAK = Math.max(0, Math.min(2000, +Q.get('soak') || 0)), SOAK_BOT = Q.has('soakbot');
let simFrames = 0;
if (SOAK || MANUAL) IN.now = () => simFrames * 1000 / 60;
if (SOAK > 1) { for (const k of ['sfx', 'voice']) { const f0 = A[k]; A[k] = (...a) => Math.random() * SOAK < 1 ? f0(...a) : false; } }   // 빨리 돌릴 때 소리는 실제 시간 비율만큼만
const bot = { mode: 'idle', until: 0, hold: {}, next: 0 };
function soakBot() {   // 가상 관람객: 2~6분 놀고 → 1~3분 쉼(데모가 돌게) 반복. 누르는 버튼은 무작위
  const t = simFrames / 60;
  if (t >= bot.until) { bot.mode = bot.mode === 'play' ? 'idle' : 'play'; bot.until = t + (bot.mode === 'play' ? 120 + Math.random() * 240 : 60 + Math.random() * 120); IN.virt[0] = IN.virt[1] = null; }
  if (bot.mode !== 'play') return;
  if (simFrames >= bot.next) {
    const o = {}; for (const b of ['l', 'r', 'u', 'd']) o[b] = Math.random() < .22; for (const b of ['p', 'k', 's', 'start']) o[b] = Math.random() < (b === 'start' ? .05 : .3);
    IN.virt[0] = o; IN.virt[1] = Math.random() < .5 ? null : Object.fromEntries(Object.keys(o).map(k => [k, Math.random() < .25]));
    if (Math.random() < .004 && IN.onMusic) IN.onMusic();   // 가끔 M(다음 곡)
    bot.next = simFrames + 2 + Math.floor(Math.random() * 14);
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(.25, (now - last) / 1000); last = now;
  let n = 0;
  try {
    if (SOAK) { for (let i = 0; i < SOAK; i++) { if (SOAK_BOT) soakBot(); step(); simFrames++; } acc = 0; }
    else if (!MANUAL) while (acc >= DT && n < 8) { step(); acc -= DT; n++; }
    if (n >= 8) acc = 0;
    const S = SCENES[scene.name]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    if (S && S.draw) S.draw(scene);
    if (NOW_PLAYING_ON[scene.name]) nowPlaying(performance.now() / 1000);   // ♪ 지금 곡 이름
    songToast();                                                              // M키 '다음 곡' 알림
  } catch (e) {
    console.error('게임 오류 → 타이틀로 복귀', e); errCount++; window.__errors = errCount;
    try { G = null; resetFx(); go('title'); } catch (e2) {}
  }
  fpsN++; if (now - fpsT > 1000) { fps = fpsN; fpsN = 0; fpsT = now; }
  if (DEBUG) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0f0'; ctx.font = '24px monospace'; ctx.textAlign = 'left'; ctx.fillText(`${fps}fps ${scene.name} fx:${fx.length} tw:${tweens.length} q:${queue.length} pads:${IN.padCount}`, 12, H - 12); ctx.restore(); }
}

// 캔버스 클릭/터치 → 메뉴 선택
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  const S = SCENES[scene.name]; if (S && S.click) S.click(x, y);
});

// 첫 입력: 소리 켜기 + 전체 화면
IN.onFirstGesture = () => {
  A.unlock();
  if (!Q.has('nofs') && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
};

// 테스트·점검용 (콘솔에서 사용)
window.GAME = {
  get scene() { return scene; }, get G() { return G; }, go, READY, SPR, startDemo,
  metaDump(key) { const o = {}; for (const k in SPR) if (k.startsWith(key + '/')) o[k.split('/')[1]] = SPR[k].meta; return JSON.stringify(o); },
  fill(side = 0) { if (G) G.f[side].meter = 100; }, ko(side = 1) { if (G && G.phase === 'fight') { G.f[side].hp = 0; doKO(G.f[side], G.f[1 - side], 1); } },   /* 점검용: 바로 K.O. */ hp(side, v) { if (G) G.f[side].hp = v; },
  steps(n, drawEvery = 0) { for (let i = 0; i < n; i++) { step(); simFrames++; if (drawEvery && i % drawEvery === 0) { const S = SCENES[scene.name]; if (S && S.draw) S.draw(scene); } } },
  draw() { const S = SCENES[scene.name]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'; if (S && S.draw) S.draw(scene); if (NOW_PLAYING_ON[scene.name]) nowPlaying(performance.now() / 1000); songToast(); },
  get STORY() { return { on: STORY, seen: Object.assign({}, STORY_SEEN) }; },
  get RUN() { return RUN; }, get fx() { return fx; }, get tweens() { return tweens; }, get queue() { return queue; }, get T() { return T; }, get simFrames() { return simFrames; }, ranking: rankLoad, rankClear,
  fakeRun(sec = 95.5, p1 = 'chodding', cont = 0) { RUN = { time: sec, cont }; go('ending', { p1 }); },   // 시험용: 가짜 클리어 기록으로 엔딩부터
  quick(p1 = 'chodding', p2 = BOSS, stage = 0, mode = 'versus', ai = [null, null]) { go('fight', { match: { mode, stage, p1, p2, ai } }); },
};

(async () => {
  requestAnimationFrame(frame);
  IN.initTouch();
  await loadAll();
  A.unlock();
  console.info('[폭투] 준비된 캐릭터:', Object.keys(READY).filter(k => READY[k]).join(', '));
  const qs = Q.get('scene');
  if (qs === 'fight') GAME.quick(Q.get('p1') || 'chodding', Q.get('p2') || BOSS, +(Q.get('stage') || 0), Q.get('mode') || 'versus', [Q.get('ai1') ? +Q.get('ai1') : null, Q.get('ai2') ? +Q.get('ai2') : null]);
  else if (qs && SCENES[qs]) go(qs, qs === 'select' ? { mode: Q.get('mode') || 'arcade' } : qs === 'ending' ? { p1: Q.get('p1') || 'chodding' } : {});
  else go('title');

// ===== 공유 순위 (깃허브 페이지판) =====
// 공유 순위 (구글 시트) — 3판 기록만 모두가 같이 보는 순위표로. 연결이 안 되면 원래대로 이 기기 순위표를 씀
// 시트 주소를 바꾸면 아래 SHEET_URL 만 고치면 돼요. 이상한 이름은 구글 시트에서 그 줄을 지우면 순위에서 빠져요.
(function () {
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxL7TWGflfvaNAyPRxngr9KvKYY8vbIigW2OPoTZamIlL-DhP7gDjdMn-kg9Ww3GfrGfA/exec';
  let shared = null;             // 시트에서 받은 TOP 10 (못 받았으면 null → 이 기기 순위)
  const localLoad = rankLoad, localAdd = rankAdd;
  const on = () => SET.rounds === 3 && Array.isArray(shared);
  const toRec = r => ({ name: String(r.name || '').slice(0, 8), key: r.char, time: Number(r.time), cont: Number(r.cont) || 0, date: '' });
  const use = list => { shared = list.map(toRec).filter(r => Number.isFinite(r.time)).sort((a, b) => a.time - b.time).slice(0, RANK_N); };

  function pull() {
    return fetch(SHEET_URL + '?n=' + RANK_N, { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (d && d.ok && Array.isArray(d.list)) use(d.list); }).catch(() => {});
  }

  rankLoad = function () { return on() ? shared.slice() : localLoad(); };
  rankAdd = function (rec) {
    localAdd(rec);                                    // 이 기기에도 같이 저장 (인터넷 끊겨도 남게)
    if (SET.rounds !== 3 || BETA) return localLoad().indexOf(rec);   // 시험판 기록은 공유 순위에 안 올림
    fetch(SHEET_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ name: rec.name, time: rec.time, char: rec.key, cont: rec.cont || 0 }) })
      .then(r => r.json()).then(d => { if (d && d.ok && Array.isArray(d.list)) use(d.list); }).catch(() => {});
    if (!on()) return localLoad().indexOf(rec);
    shared.push(rec); shared.sort((a, b) => a.time - b.time); shared = shared.slice(0, RANK_N);   // 답 오기 전에 바로 보이게
    return shared.indexOf(rec);
  };

  // 순위표를 열 때마다 최신 순위를 다시 받아 옴
  const R = SCENES.ranking, enter0 = R.enter, draw0 = R.draw;
  R.enter = function (s) {
    enter0.call(this, s);
    pull().then(() => { if (scene === s && on()) s.list = rankLoad().map(r => (s.hi && r.name === s.hi.name && r.time === s.hi.time ? s.hi : r)); });
  };
  R.draw = function (s) {
    draw0.call(this, s);
    label(on() ? '전체 순위' : '이 기기 순위', W - 60, 60, 34, on() ? '#19f5c8' : '#aaa', FONT, 'right', 5);
  };
  pull();

  // ── 방문·플레이 기록 (10/2): 들어옴 / 시작 / 짐(몇 판) / 깸 — 게임 내용은 그대로, 숫자만 셈
  const SID = Math.random().toString(36).slice(2, 10);
  const DEV = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'pc';
  function logEv(type, extra) {
    if (BETA) return;   // 시험판(beta.html)은 기록 안 남김
    try { fetch(SHEET_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ type, sid: SID, dev: DEV }, extra || {})) }).catch(() => {}); } catch (e) {}
  }
  logEv('visit');
  let lastRun = null;
  const go0 = go;
  go = function (name, data) {
    data = data || {};
    try {
      const m = data.match;
      if (name === 'vs' && m && m.mode === 'arcade' && RUN && RUN !== lastRun) { lastRun = RUN; logEv('start', { char: m.p1, stage: m.stage }); }
      if (name === 'continue' && m && m.mode === 'arcade') logEv('lose', { char: m.p1, stage: m.stage, cont: RUN ? RUN.cont : 0 });
      if (name === 'ending' || (name === 'comic' && data.src === STORY_CLIPS.end)) logEv('clear', { char: data.p1 || (G && G.opt && G.opt.p1) || '', cont: RUN ? RUN.cont : 0 });
    } catch (e) {}
    return go0(name, data);
  };
})();
  window.__ready = true;
})();
})();
