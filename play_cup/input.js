// 입력: 키보드 두 벌 + 게임패드 2개(표준 배치) + 화면 터치 버튼
// 매 프레임 Input.poll() → Input.p[0], Input.p[1] = { l r u d p k s, pressed: {..새로 눌린 것}, any }
(function () {
  const I = window.Input = {};
  const KEYMAP = [
    { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], p: ['KeyF'], k: ['KeyG'], s: ['KeyH'], start: ['Enter', 'Space'] },
    { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], p: ['Numpad1', 'Comma'], k: ['Numpad2', 'Period'], s: ['Numpad3', 'Slash'], start: ['NumpadEnter', 'Numpad0'] },
  ];
  const BTN = ['l', 'r', 'u', 'd', 'p', 'k', 's', 'start'];
  const down = new Set(); let anyKey = false;
  const touch = { l: 0, r: 0, u: 0, d: 0, p: 0, k: 0, s: 0, start: 0 };
  const prev = [{}, {}];
  I.p = [mk(), mk()];
  I.now = () => performance.now();   // 무입력 타이머 시계 (점검용 ?soak 에서는 게임 시간으로 바뀜)
  I.virt = [null, null];             // 점검·자동 시험용 가상 버튼 { l r u d p k s start } (true = 누르고 있음). 평소엔 비어 있음
  I.lastInput = I.now();
  I.anyPressed = false;
  I.onFirstGesture = null;
  I.onMusic = null;                  // 다음 곡 (M · Tab · 패드 Back) → game.js 에서 연결
  let musicPrev = false;
  function mk() { const o = { pressed: {} }; for (const b of BTN) { o[b] = false; o.pressed[b] = false; } o.any = false; o.src = ''; return o; }

  const ALLOW = new Set(['F12']);   // 개발자 도구만 허용
  addEventListener('keydown', e => {
    if (!ALLOW.has(e.code)) e.preventDefault();
    if (e.code === 'KeyM' || e.code === 'Tab') { gesture(); if (!e.repeat) { I.lastInput = I.now(); if (I.onMusic) I.onMusic(); } return; }   // 다음 곡 (게임 버튼으로는 안 셈)
    if (!e.repeat) { down.add(e.code); I.lastInput = I.now(); anyKey = true; }
    if (e.code === 'KeyT' && e.shiftKey) I.toggleTouch();
    gesture();
  }, { passive: false });
  addEventListener('keyup', e => { down.delete(e.code); if (!ALLOW.has(e.code)) e.preventDefault(); });
  addEventListener('blur', () => down.clear());
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('pointerdown', () => { I.lastInput = I.now(); gesture(); });
  addEventListener('touchstart', () => { if (!I.touchOn && !I._autoTouch) { I._autoTouch = true; I.setTouch(true); } }, { passive: true });
  function gesture() { if (I.onFirstGesture) I.onFirstGesture(); }

  // ---------- 게임패드 ----------
  function readPad(gp) {
    const o = {}; if (!gp) return null;
    const b = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > .5));
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    o.l = b(14) || ax < -.5; o.r = b(15) || ax > .5; o.u = b(12) || ay < -.6; o.d = b(13) || ay > .6;
    o.p = b(0) || b(2); o.k = b(1) || b(4) || b(6); o.s = b(3) || b(5) || b(7); o.start = b(9);   // b(8) Back/Select = 다음 곡 (poll 에서)
    return o;
  }
  I.padCount = 0;

  I.poll = function () {
    let pads = [];
    try { pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean); } catch (e) {}
    I.padCount = pads.length;
    const mb = pads.some(gp => gp.buttons[8] && gp.buttons[8].pressed); if (mb && !musicPrev) { I.lastInput = I.now(); gesture(); if (I.onMusic) I.onMusic(); } musicPrev = mb;
    I.anyPressed = anyKey; anyKey = false;
    for (let pi = 0; pi < 2; pi++) {
      const km = KEYMAP[pi], cur = I.p[pi], pad = readPad(pads[pi]);
      let any = false;
      for (const bt of BTN) {
        let v = km[bt].some(c => down.has(c));
        if (pad && pad[bt]) { v = true; }
        if (pi === 0 && touch[bt]) v = true;
        if (I.virt[pi] && I.virt[pi][bt]) v = true;
        const was = !!prev[pi][bt];
        cur[bt] = v; cur.pressed[bt] = v && !was; prev[pi][bt] = v;
        if (cur.pressed[bt]) { any = true; }
      }
      cur.any = any;
      if (any) { I.anyPressed = true; I.lastInput = I.now(); }
    }
    // 게임패드만 쓰는 전시 환경: 버튼을 누르고 있는 동안에도 무입력 타이머를 멈춤
    if (BTN.some(b => I.p[0][b] || I.p[1][b])) I.lastInput = I.now();
  };
  // 1인 모드: 두 벌 입력을 합쳐서 어느 쪽으로도 조종 가능
  I.merged = function () {
    const a = I.p[0], b = I.p[1], o = { pressed: {} };
    for (const bt of BTN) { o[bt] = a[bt] || b[bt]; o.pressed[bt] = a.pressed[bt] || b.pressed[bt]; }
    o.any = a.any || b.any; return o;
  };
  I.idleMs = () => I.now() - I.lastInput;

  // ---------- 터치 버튼 ----------
  I.touchOn = false;
  I.setTouch = function (on) {
    I.touchOn = on; const el = document.getElementById('touch'); if (el) el.style.display = on ? 'block' : 'none';
    const tg = document.getElementById('touchToggle'); if (tg) tg.classList.toggle('on', on);
    try { localStorage.setItem('pt_touch', on ? '1' : '0'); } catch (e) {}
  };
  I.toggleTouch = () => I.setTouch(!I.touchOn);
  I.initTouch = function () {
    const root = document.getElementById('touch');
    // 방향 패드 = 한 손가락 조이스틱: 누른 곳의 방향(8방향)으로 → ▶와 ▼ 사이를 누르면 대각선(↘)
    const pad = root.querySelector('.pad'), pts = new Map(), dirBtn = {};
    if (pad) {
      pad.style.pointerEvents = 'auto'; pad.style.touchAction = 'none';
      pad.querySelectorAll('[data-b]').forEach(el => { el.style.pointerEvents = 'none'; dirBtn[el.dataset.b] = el; });
      const upd = () => {
        const r = pad.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, o = { l: 0, r: 0, u: 0, d: 0 };
        for (const [x, y] of pts.values()) { const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy); if (dd < r.width * .12) continue;
          if (dx > dd * .38) o.r = 1; if (dx < -dd * .38) o.l = 1; if (dy > dd * .38) o.d = 1; if (dy < -dd * .38) o.u = 1; }
        for (const b in o) { touch[b] = o[b]; if (dirBtn[b]) dirBtn[b].classList.toggle('down', !!o[b]); }
      };
      pad.addEventListener('pointerdown', e => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (_) {} pts.set(e.pointerId, [e.clientX, e.clientY]); upd(); I.lastInput = I.now(); gesture(); });
      pad.addEventListener('pointermove', e => { if (pts.has(e.pointerId)) { pts.set(e.pointerId, [e.clientX, e.clientY]); upd(); } });
      const end = e => { pts.delete(e.pointerId); upd(); };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, end);
    }
    root.querySelectorAll('.btns [data-b]').forEach(el => {
      const bs = el.dataset.b.split(' ');
      const on = e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} bs.forEach(b => touch[b] = 1); el.classList.add('down'); I.lastInput = I.now(); gesture(); };
      const off = e => { e.preventDefault(); bs.forEach(b => touch[b] = 0); el.classList.remove('down'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    });
    const tg = document.getElementById('touchToggle');
    tg.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); I.toggleTouch(); });
    let saved = null; try { saved = localStorage.getItem('pt_touch'); } catch (e) {}
    I.setTouch(saved === '1' || (saved === null && window.matchMedia && matchMedia('(pointer: coarse)').matches));   // 웹 링크판: 휴대폰이면 터치 버튼 자동으로 켬
  };
})();
