// 소리: 목소리(sfx/*.mp3) + 합성 효과음 + 배경음악 한 곡(bgm/, 배경음악 고르기 화면에서 고른 곡) — index.html · select.html 에서 가져옴
// 로컬 서버로 열면 WebAudio 로 미리 풀어 두고, 파일 더블클릭(file://)이면 <audio> 로 대신 재생
(function () {
  const A = window.Audio2 = {};
  let AC = null, MASTER = null, BGM = null, NOISE = null;
  const BUF = {}, TAGS = {}, PEND = new Set(), MISSING = A.MISSING = new Set();
  let names = [], unlocked = false, useTags = false;

  A.setVoices = list => { names = [...new Set(list.filter(Boolean))]; if (AC) loadVoices(); };
  A.ready = () => !!AC && AC.state === 'running';

  A.unlock = async function () {
    if (!AC) {
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      MASTER = AC.createGain(); MASTER.gain.value = .9; MASTER.connect(AC.destination);
      BGM = AC.createGain(); BGM.gain.value = .55; BGM.connect(MASTER);
      NOISE = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = NOISE.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      loadVoices();
    }
    if (AC.state !== 'running') { try { await AC.resume(); } catch (e) {} }
    unlocked = AC.state === 'running';
    if (unlocked && want) A.bgm('resume');
  };
  async function loadVoices() {
    if (location.protocol === 'file:') { useTags = true; }
    for (const n of names) {
      if (BUF[n] || TAGS[n] || PEND.has(n)) continue; PEND.add(n);
      if (!useTags) {
        let r = null;
        try { r = await fetch(`sfx/${n}.mp3`); } catch (e) { useTags = true; }        // fetch 자체가 안 됨(file:// 등) → <audio> 로
        if (r && !r.ok) { MISSING.add(n); continue; }                             // 파일 하나 없음(404) → 그 목소리만 건너뜀 (다른 목소리는 그대로)
        if (r) { try { BUF[n] = await AC.decodeAudioData(await r.arrayBuffer()); continue; } catch (e) { MISSING.add(n); continue; } }
      }
      const a = new Audio(`sfx/${n}.mp3`); a.preload = 'auto'; TAGS[n] = a;
    }
  }
  const tagPool = [];
  A.has = n => !!(BUF[n] || TAGS[n]);
  A.voice = function (n, vol = 1) {
    if (!n || !AC || AC.state !== 'running') return false;   // 돌려주는 값: 소리 파일이 있어서 재생했으면 true (없으면 다른 목소리로 대신할 수 있게)
    if (BUF[n]) { const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = BUF[n]; g.gain.value = vol; s.connect(g).connect(MASTER); s.start(); return true; }
    const t = TAGS[n]; if (!t) return false;
    let a = tagPool.find(x => x.ended || x.paused); if (!a) { if (tagPool.length >= 8) a = tagPool.shift(); else a = new Audio(); tagPool.push(a); }
    try { a.src = t.src; a.volume = Math.min(1, vol * .9); a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
    return true;
  };

  function osc(type, f0, f1, dur, vol, when = 0, dest = MASTER) {
    const t = AC.currentTime + when, o = AC.createOscillator(), g = AC.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + .02);
  }
  function noise(dur, vol, fType, f0, f1, when = 0, dest = MASTER, q = 1) {
    const t = AC.currentTime + when, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    s.buffer = NOISE; f.type = fType; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + dur + .02);
  }
  A.sfx = function (k, big = 1) {
    if (!AC || AC.state !== 'running') return;
    switch (k) {
      case 'hit': noise(.12 * big, .9, 'lowpass', 2400, 300); osc('sine', 150 * (big > 1.3 ? .7 : 1), 45, .16 * big, .9); break;
      case 'whoosh': noise(.2, .3, 'bandpass', 500, 2600, 0, MASTER, 2); break;
      case 'guard': osc('triangle', 1500, 1300, .15, .35); osc('sine', 2300, 2100, .12, .2, .01); noise(.06, .3, 'highpass', 3000, 5000); break;
      case 'jump': osc('square', 320, 820, .14, .1); break;
      case 'land': noise(.08, .25, 'lowpass', 700, 150); break;
      case 'step': noise(.05, .1, 'lowpass', 600, 200); break;
      case 'boing': osc('sine', 180, 520, .09, .5); osc('sine', 520, 160, .22, .4, .09); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => osc('triangle', f, f, .15, .22, i * .07)); break;
      case 'charge': { const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 1.2); f.type = 'lowpass'; f.frequency.value = 1800;
        g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(.16, t + .8); g.gain.exponentialRampToValueAtTime(.001, t + 1.3); o.connect(f).connect(g).connect(MASTER); o.start(t); o.stop(t + 1.35); break; }
      case 'wind': noise(1.6, .3, 'bandpass', 300, 1400, 0, MASTER, 1.5); break;
      case 'ko': osc('sine', 90, 28, 1.2, 1); noise(.8, .8, 'lowpass', 3000, 100); break;
      case 'blip': osc('square', 880, 1320, .06, .1); break;
      case 'move': osc('square', 660, 990, .05, .09); break;
      case 'select': osc('square', 523, 1047, .15, .2); osc('square', 784, 1568, .2, .15, .08); noise(.3, .35, 'bandpass', 2500, 2500); break;
      case 'back': osc('square', 700, 300, .12, .12); break;
      case 'deny': osc('square', 180, 150, .18, .15); break;
      case 'sparkle': [1568, 2093, 2637].forEach((f, i) => osc('sine', f, f, .12, .12, i * .05)); break;
      case 'fire': noise(.5, .3, 'bandpass', 900, 300, 0, MASTER, .8); for (let i = 0; i < 5; i++) noise(.03, .2, 'highpass', 3000, 5000, i * .07); break;
      case 'ring': for (let i = 0; i < 2; i++) { osc('sine', 1320, 1320, .12, .2, i * .35); osc('sine', 1580, 1580, .12, .15, i * .35 + .13); } break;
      case 'siren': { const v = .08 * Math.min(3, big); for (let i = 0; i < 2; i++) { osc('triangle', 880, 880, .18, v, i * .4); osc('triangle', 1175, 1175, .18, v, i * .4 + .2); } break; }   // big = 크기 (119 신고: 점점 크게)
      case 'cutin': noise(.35, .5, 'bandpass', 400, 4000, 0, MASTER, 1.2); osc('sawtooth', 220, 880, .3, .12); break;
      case 'stomp': osc('sine', 70, 30, .5, 1); noise(.4, .6, 'lowpass', 900, 80); break;
      case 'vs': osc('sine', 110, 40, .6, .9); noise(.5, .6, 'lowpass', 2000, 200); break;
      case 'count': osc('square', 440, 440, .1, .12); break;
      case 'pew': osc('square', 1400, 180, .13, .16); noise(.07, .5, 'lowpass', 3500, 400); osc('sine', 120, 50, .12, .5); break;   // 만화 총소리 (군인 필살기)
      case 'spin': for (let i = 0; i < 4; i++) noise(.09, .18, 'bandpass', 1800, 900, i * .09, MASTER, 3); osc('sine', 1760, 2640, .25, .07); break;   // 안경 빙글빙글
      case 'catch': osc('triangle', 1320, 1760, .08, .18); osc('sine', 2637, 2637, .12, .1, .06); break;
      // 필살기 연출 (9/29): 심장 소리 · 슬로모션 쉭 · 팡 · 도장 쾅 · 냠 · 종이 · 물 · 큰 충격 · 동전 · 떨어지는 소리
      case 'heart': osc('sine', 62, 38, .16, .9); osc('sine', 58, 36, .14, .7, .2); break;
      case 'slow': noise(1.3, .35, 'lowpass', 1600, 160, 0, MASTER, 1.2); osc('sine', 220, 70, 1.2, .18); break;
      case 'pang': noise(.18, 1, 'lowpass', 5000, 400); osc('square', 900, 120, .16, .22); osc('sine', 140, 40, .45, 1); noise(.5, .5, 'bandpass', 1200, 300, .05, MASTER, .8); break;
      case 'stamp': osc('sine', 130, 45, .3, 1); noise(.12, .7, 'lowpass', 1800, 200); break;
      case 'chomp': noise(.07, .6, 'bandpass', 1800, 900, 0, MASTER, 2); noise(.07, .6, 'bandpass', 1600, 800, .1, MASTER, 2); osc('sine', 300, 180, .1, .25); break;
      case 'paper': for (let i = 0; i < 6; i++) noise(.05, .12, 'highpass', 2500, 5000, i * .05); break;
      case 'splash': noise(.6, .6, 'bandpass', 2400, 500, 0, MASTER, .7); for (let i = 0; i < 5; i++) osc('sine', 900 + i * 180, 1600, .06, .08, .05 + i * .05); break;
      case 'bigboom': osc('sine', 80, 26, 1.1, 1); noise(.9, .9, 'lowpass', 2600, 60); noise(.3, .5, 'bandpass', 900, 200, .02, MASTER, .8); break;
      case 'coins': for (let i = 0; i < 10; i++) osc('triangle', 2000 + (i % 3) * 400, 2400 + (i % 4) * 300, .07, .08, i * .07); break;
      case 'fall': osc('sine', 1200, 200, .5, .18); noise(.5, .25, 'bandpass', 2000, 400, 0, MASTER, 1.5); break;
    }
  };

  // ---------- 배경음악 (한 곡만!) ----------
  // 9/29 다래: 게임을 시작할 때 '배경음악 고르기' 화면에서 고른 한 곡이 캐릭터 선택·대전·K.O.·이어하기·순위표까지 끊김 없이 계속 흐른다.
  // 규칙: ① 소리 나는 <audio>는 언제나 딱 하나(cur) ② A.bgm(무엇이든) = 고른 곡이 재생 중인지 확인만(멈춰 있으면 이어서 재생, 처음부터 다시 X)
  //       ③ 곡 바꾸기는 A.setTrack() 하나뿐 — 배경음악 고르기 화면과 '다음 곡'(M키 등)만 부름 ④ 바꿀 때는 다른 모든 곡을 먼저 멈춤 (두 곡이 섞일 수 없음)
  const MUSIC = A.MUSIC = [   // 9/29 다래 최종 곡 목록 (이 순서)
    { id: 'citypop', file: 'citypop.mp3', name: '시티팝', sub: '반짝반짝 도시의 밤 노래' },
    { id: 'pansori', file: 'trot.mp3', name: '현대 판소리', sub: '얼씨구! 북장단에 요즘 소리' },
    { id: 'trot', file: 'trot_techno.mp3', name: '트로트', sub: '어깨가 들썩! 신나는 뽕짝 댄스' },
    { id: 'jazz', file: 'jazz.mp3', name: '재즈', sub: '둥실둥실 멋쟁이 색소폰' },
    { id: 'off', file: null, name: '음악 끄기', sub: '목소리·효과음만 들려요', off: true },   // 9/29 다래: 음악 끄기 (목소리·효과음은 그대로)
  ];
  const BGM_LEVEL = .55;
  const TRACKS = {};              // id → { el, g(GainNode|null), lv(0~1), timer }
  let chosen = 'citypop', cur = null, want = false, gen = 0;
  let hold = false;              // 만화 컷씬이 나오는 동안 true → 게임 음악을 멈춰 두고 아무도 다시 켜지 못하게
  A.bgmHold = function (on) { hold = !!on; if (hold) { ++gen; for (const k in TRACKS) { const t = TRACKS[k]; clearInterval(t.timer); t.timer = null; if (!t.el.paused) t.el.pause(); } } };
  try { const sv = sessionStorage.getItem('pt_music'); if (sv && MUSIC.some(m => m.id === sv)) chosen = sv; } catch (e) {}   // 이번 창(세션) 동안 고른 곡·끄기 기억
  const info = id => MUSIC.find(m => m.id === id) || MUSIC[0];
  function track(id) {
    if (TRACKS[id]) return TRACKS[id];
    if (info(id).off) return null;   // '음악 끄기'는 <audio>를 만들지 않음
    const el = new Audio('bgm/' + info(id).file); el.loop = true; el.preload = 'auto';
    const t = { id, el, g: null, lv: 0, timer: null };
    try { if (AC && location.protocol !== 'file:') { t.g = AC.createGain(); t.g.gain.value = 0; AC.createMediaElementSource(el).connect(t.g).connect(BGM); } } catch (e) { t.g = null; }
    if (!t.g) el.volume = 0;
    return (TRACKS[id] = t);
  }
  function setLv(t, v) { t.lv = v; if (t.g) t.g.gain.value = v; else t.el.volume = Math.max(0, Math.min(1, v * .64)); }
  function fade(t, to, dur, done) {
    clearInterval(t.timer); t.timer = null;
    if (dur <= 0) { setLv(t, to); if (done) done(); return; }
    const from = t.lv, t0 = performance.now();
    t.timer = setInterval(() => { const p = Math.min(1, (performance.now() - t0) / (dur * 1000)); setLv(t, from + (to - from) * p);
      if (p >= 1) { clearInterval(t.timer); t.timer = null; if (done) done(); } }, 16);
  }
  function stopOthers(keep) { for (const k in TRACKS) { const t = TRACKS[k]; if (t !== keep) { clearInterval(t.timer); t.timer = null; if (!t.el.paused) t.el.pause(); setLv(t, 0); } } }
  function startCur() {   // cur 곡을 (멈춘 자리에서) 재생 — 다른 곡은 모두 멈춤
    if (!cur) return; stopOthers(cur);
    if (cur.el.paused) { if (cur.lv <= 0) setLv(cur, 0); cur.el.play().catch(() => {}); }
    if (cur.lv < 1 && !cur.timer) fade(cur, 1, .2);
  }
  // 곡 바꾸기 — 곡을 바꾸는 길은 이 함수 하나뿐 (배경음악 고르기 화면 · M/Tab/패드 Back/♪버튼 '다음 곡')
  // 지금 곡을 0.2초에 줄여 멈춘 뒤, 새 곡을 0.2초에 키움 → 한 번에 한 곡만 들림. 연타해도 매번 다른 곡은 즉시 멈추고, 마지막 곡만 시작
  A.setTrack = function (idOrIndex) {
    const id = typeof idOrIndex === 'number' ? MUSIC[((idOrIndex % MUSIC.length) + MUSIC.length) % MUSIC.length].id : idOrIndex;
    chosen = info(id).id;
    try { sessionStorage.setItem('pt_music', chosen); } catch (e) {}
    if (info(chosen).off) { ++gen; want = true; stopOthers(null); cur = null; return; }   // 음악 끄기: 모든 곡 멈춤 + 소리 0
    if (!AC || AC.state !== 'running' || hold) { want = true; if (hold && cur && cur.id !== chosen) cur = null; return; }
    want = true; const my = ++gen, next = track(chosen);
    if (cur === next) { startCur(); return; }
    const old = cur; stopOthers(old);
    const go = () => { if (my !== gen) return; if (old) { old.el.pause(); setLv(old, 0); } cur = next; stopOthers(cur); setLv(cur, 0); cur.el.play().catch(() => {}); fade(cur, 1, .2); };
    if (old && !old.el.paused) fade(old, 0, .2, go); else go();
  };
  A.pickMusic = A.setTrack;
  A.nextTrack = function () { A.setTrack(MUSIC.findIndex(m => m.id === chosen) + 1); return info(chosen); };
  A.music = () => info(chosen);                 // { id, file, name, sub } (아이콘은 game.js songIcon 이 그림)
  A.musicId = () => chosen;
  A.musicOff = () => !!info(chosen).off;
  A.bgm = function (name) {                     // 무엇을 넘겨도 '고른 곡'이 흐르도록만 함 (곡을 바꾸지 않음)
    if (name === null) return;                  // 예전 코드의 A.bgm(null) — 이제 음악을 끊지 않음
    want = true;
    if (info(chosen).off) { stopOthers(null); cur = null; return; }   // 음악 끔 → 아무것도 켜지 않음
    if (!AC || AC.state !== 'running' || hold) return;
    BGM.gain.cancelScheduledValues(AC.currentTime); BGM.gain.setValueAtTime(BGM.gain.value, AC.currentTime); BGM.gain.linearRampToValueAtTime(BGM_LEVEL, AC.currentTime + .4);
    if (!cur) { cur = track(chosen); setLv(cur, 0); }
    startCur();
  };
  // 예전엔 K.O.·타임오버 때 음악을 멈췄지만, 이제는 끊지 않고 살짝 작게만 (다음 A.bgm 에서 원래 크기로)
  A.bgmStop = function () { if (AC && AC.state === 'running' && cur) A.duck(.22, .5); };
  A.duck = function (v, dur = .3) { if (AC && AC.state === 'running') { BGM.gain.cancelScheduledValues(AC.currentTime); BGM.gain.setValueAtTime(BGM.gain.value, AC.currentTime); BGM.gain.linearRampToValueAtTime(v, AC.currentTime + dur); } };
  A.stats = () => ({ tracks: Object.keys(TRACKS).length, tags: Object.keys(TAGS).length, pool: tagPool.length, bufs: Object.keys(BUF).length, missing: [...MISSING] });   // 점검용 (오래 돌리기)
  // 점검용: 콘솔에서 Audio2.debugTracks()
  A.debugTracks = () => ({ chosen, cur: cur && cur.id, playing: Object.values(TRACKS).filter(t => !t.el.paused).map(t => t.el.src.split('/').pop()),
    tracks: Object.values(TRACKS).map(t => ({ id: t.id, src: t.el.src.split('/').pop(), paused: t.el.paused, time: +t.el.currentTime.toFixed(2), lv: +t.lv.toFixed(2) })), master: BGM ? +BGM.gain.value.toFixed(2) : null });
})();
