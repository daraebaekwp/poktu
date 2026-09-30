// =====================================================================
//  폭투 영남알프스 — 플레이용 캐릭터 등록부 (play.html 이 읽음)
//  새 캐릭터 추가 = sprites/ 에 그림 넣기 + 아래 CHARACTERS 에 한 덩어리 추가 + ROSTER 칸의 key 연결
//  자세한 규칙은 플레이_사용법.md 의 "캐릭터 추가하기" 참고
// =====================================================================
//
// 좌표 약속 (모든 캐릭터 공통)
//  - 화면 1920×1080, 바닥선 y=1010. 그림 배율 = PLAY_SCALE(0.46) × META.k × size
//  - META[그림이름] = { k: 크기 보정(기본 1), ax: 그림 안의 몸 중심 x(px), ay: 그림 안의 발바닥 y(px), flip: true면 그 그림만 반대 방향 }
//    · META 를 비워 두면(또는 ax/ay 생략) 로컬 서버로 열었을 때 자동 계산(발바닥=가장 아래 불투명 픽셀, 중심=발 부근 가운데)
//  - facing: 그림 파일 속 캐릭터가 보는 방향. 1 = 오른쪽, -1 = 왼쪽
//    (9/29 방향 점검) 그림 속에서 반대쪽을 보는 자세는 META 에 flip: true — g_duck·g_block·g_land · a_idle·a_crouch·a_guard·a_taunt·a_sp_swing·a_sp_glasses · m_crouch
//  - 판정 상자(hitbox)는 "화면 px", 캐릭터가 오른쪽을 볼 때 기준. x = 몸 중심에서 앞으로 떨어진 시작점, w = 앞으로 뻗은 길이,
//    y = 바닥에서 상자 아래쪽까지 높이, h = 상자 높이. (size 는 곱하지 않음 — 적은 숫자 그대로 씀)
//  - 프레임 = 1/60초. startup(준비) → active(맞는 순간) → recovery(회복)
//  - level: 'mid'(서서·앉아 막기 둘 다 됨) / 'low'(앉아 막기만) / 'high'(서서 막기만 — 점프 공격)
//
// 필수 poses 이름 (값 = sprites/ 안의 파일 이름, .png 제외)
//  idle walk jump crouch guard crouchGuard hit crouchHit down ko win lose intro taunt
// 필살기(specials)는 경기장 순서대로 3개: [신불산, 영축산, 가지산]. 2인 대전에서는 고른 경기장 번호의 필살기를 씀.
// 필살기 vfx.type: 'projectile'(날아가는 그림) · 'multi'(여러 발) · 'whirl'(땅 위 회오리) · 'siren'(화면 전체 신고·가드 불가)
//   vfx.img: 'whale' | 'buoy' | 'fire' | 'cloud'(그려서 만듦) | 그 밖에는 vfx/<이름>.png 를 자동으로 읽음
//   (2026-09-29 추가) vfx.type 'gun'(군인: 둥근 총구 불꽃 + 캡슐 총알 shots발, 마지막 발 넉백) · 'glasses'(예술가: 안경이 빙글 날아가 맞고 되돌아옴) — 둘 다 코드로 그림
//   필살기 연출 값: hold(컷인 뒤 멈춘 채 보여 줄 프레임) · pre[[자세, 프레임]](멈춘 동안 자세 순서) · voiceAt(목소리 나오는 프레임, 없으면 컷인과 함께)
//     shout(말풍선 글자) · glintAt(안경 반짝) · anim[[자세, 프레임]](발사 뒤 자세 순서) · signature(선택 화면·기술표에 뜨는 대표 필살기 한 줄)
//     (9/29) cine: game.js CINE 연출 이름(슬로모션·카메라·도장 등) · cutinF: 컷인 길이(프레임, 기본 72) · vfx.type 'custom' = 연출 코드가 직접 발사
//
// 연계기 · 기술 (2026-09-29 추가)
//  - moves.X.chain: 같은 버튼을 한 번 더 → 다음 기술 (맞았을 때만)   moves.X.links: { k: '다음기술' } 다른 버튼으로 이어지는 연계
//  - moves.X.comboName: 3단째로 맞으면 화면에 뜨는 콤보 이름
//  - commands: [{ name, move, btn: 'p'|'k', motion: '236'|'214'|'623', easy: 'f'|'b'|'df', desc }]
//      motion = 커맨드(↓↘→ 등, 20프레임 안에 대충 맞으면 인정)  easy = 쉬운 입력(방향 누른 채 버튼). 둘 다 됨
//      f = 앞(→ 상대 쪽) · b = 뒤(←) · df = 앞 아래(↘).  숫자는 키패드 방향(6 = 앞, 4 = 뒤, 2 = 아래, 3 = 앞 아래)
//  - rapid: { move, name } 펀치를 빠르게 3번 누르면 나가는 연타
//  - 기술 전용 값: dash(앞으로 미끄러지는 속도) · hop: { vy, vx }(뛰어오름) · invul(무적 프레임) · multi(몇 프레임마다 다시 맞음)
//      proj: { img, size, speed, y, dmg } 작은 발사체 · wave: { speed, dmg, kd } 땅을 타고 가는 충격파(앉아 막기)
//      rings: true 둥근 음파 효과 · meter: 게이지 채우기 · popStart: 시작할 때 뜨는 글자
// =====================================================================

window.PLAY_SCALE = 0.46;

window.CHARACTERS = {
  // ------------------------------------------------------------ 초딩
  chodding: {
    name: '초딩', en: 'CHODING', age: '9세', tag: '산을 지키는 꼬마',
    col: ['#ffe600', '#7b2cff'],
    face: 'roster/face_chodding.jpg', vs: 'roster/vs_g.jpg', fight: 'roster/fight_g.jpg', fightCut: 'roster/fight_g_nukki.webp',
    portrait: { sx: 190, sy: 300, size: 560 },       // 체력바 옆 얼굴: face 그림에서 잘라 쓸 정사각형
    facing: 1, size: 1,
    headH: 500,                                       // 바닥에서 머리 꼭대기까지(말풍선·어지러움 별 위치)
    body: { hw: 70, h: 500, crouchH: 320 },           // 몸 판정(맞는 상자): 반폭, 서 있을 때 높이, 앉았을 때 높이
    speed: { walk: 7.5, back: 6, jumpV: 25, jumpX: 7, gravity: 1.25 },
    meterGain: 1,
    poses: {
      idle: 'g_guard', walk: 'g_walk', jump: 'g_jump', crouch: 'g_duck', guard: 'g_block', crouchGuard: 'g_duck',
      hit: 'g_reel', crouchHit: 'g_duck', down: 'g_down', ko: 'g_down', win: 'g_win', lose: 'g_sit',
      intro: 'g_bow', taunt: 'g_wink', land: 'g_land',
    },
    META: {
      g_guard: { k: .94, ax: 259, ay: 1347 }, g_walk: { k: .885, ax: 353, ay: 1385 }, g_jump: { k: 1.2, ax: 190, ay: 1232 },
      g_duck: { k: .94, ax: 335, ay: 1328, flip: true }, g_block: { k: 1.2, ax: 273, ay: 1232, flip: true }, g_reel: { k: .94, ax: 540, ay: 1332 },
      g_down: { k: .885, ax: 418, ay: 1385 }, g_win: { k: .885, ax: 277, ay: 1385 }, g_sit: { k: .865, ax: 293, ay: 1400 },
      g_bow: { k: .85, ax: 402, ay: 1350 }, g_wink: { k: .8, ax: 452, ay: 1350 }, g_land: { k: .95, ax: 301, ay: 1354, flip: true },
      g_punch2: { k: 1.2, ax: 333, ay: 1232 }, g_rapid: { k: 1.2, ax: 247, ay: 1232 }, g_upper: { k: 1, ax: 233, ay: 1387 },
      g_kick: { k: 1.2, ax: 500, ay: 1232, flip: true }, g_round: { k: 1.2, ax: 187, ay: 1232 }, g_sweep: { k: 1, ax: 265, ay: 1387 },
      g_knee: { k: 1, ax: 253, ay: 1387 }, g_charge: { k: .885, ax: 384, ay: 1385 }, g_special: { k: 1.2, ax: 333, ay: 1232 },
      g_phone: { k: .865, ax: 280, ay: 1387 }, g_windup: { k: .865, ax: 260, ay: 1387 }, g_throw: { k: .865, ax: 297, ay: 1387 },
      g_head: { k: 1.2 }, g_shrug: { k: .8 },             // 임시 대체 그림(잘린 g_reel·g_sit 대신) — 위치는 자동 계산
    },
    // 기본기: punch/kick 는 연속으로 누르면 chain 순서대로 이어짐(맞았을 때만)
    moves: {
      punch:  { pose: 'g_punch2', startup: 5, active: 4, recovery: 9,  dmg: 5, hitstun: 16, blockstun: 10, push: 7,  hitbox: { x: 40, w: 160, y: 300, h: 130 }, level: 'mid', chain: 'punch2', voice: 'g_yap' },
      punch2: { pose: 'g_rapid',  startup: 4, active: 4, recovery: 9,  dmg: 4, hitstun: 16, blockstun: 10, push: 7,  hitbox: { x: 40, w: 160, y: 300, h: 130 }, level: 'mid', chain: 'punch3', links: { k: 'kick2' } },
      punch3: { pose: 'g_upper',  startup: 5, active: 5, recovery: 18, dmg: 8, hitstun: 26, blockstun: 12, push: 12, hitbox: { x: 10, w: 150, y: 280, h: 300 }, level: 'mid', kd: true, big: 1.1, voice: 'g_hat', hy: 470, comboName: '삼단 펀치!' },
      kick:   { pose: 'g_kick',   startup: 8, active: 5, recovery: 14, dmg: 8, hitstun: 20, blockstun: 12, push: 10, hitbox: { x: 60, w: 200, y: 330, h: 180 }, level: 'mid', chain: 'kick2', voice: 'g_yap', big: .9 },
      kick2:  { pose: 'g_round',  startup: 6, active: 5, recovery: 18, dmg: 10, hitstun: 26, blockstun: 14, push: 16, hitbox: { x: 40, w: 230, y: 220, h: 200 }, level: 'mid', kd: true, big: 1.1, voice: 'g_iyap', comboName: '펀치 펀치 킥!' },
      // 기술 (commands 에서 부름)
      cmdToss:  { anim: [['g_windup', 0], ['g_throw', 10]], startup: 12, active: 1, recovery: 22, proj: { img: 'whale', size: 250, speed: 15, y: 330, dmg: 7, col: 'rgb(255,200,60)' }, voice: 'g_yap' },
      cmdUpper: { pose: 'g_upper', startup: 3, active: 10, recovery: 20, dmg: 9, hitstun: 24, blockstun: 14, push: 10, hitbox: { x: 0, w: 170, y: 200, h: 440 }, level: 'mid', kd: true, hop: { vy: 17, vx: 3 }, invul: 9, antiAir: true, big: 1.1, voice: 'g_hat' },
      cmdSpin:  { anim: [['g_windup', 0], ['g_round', 7]], startup: 9, active: 9, recovery: 18, dmg: 9, hitstun: 22, blockstun: 12, push: 14, hitbox: { x: 20, w: 240, y: 220, h: 220 }, level: 'mid', kd: true, dash: 10, voice: 'g_iyap' },
      rapid:    { anim: [['g_rapid', 0], ['g_punch2', 5], ['g_rapid', 10], ['g_punch2', 15], ['g_rapid', 20]], startup: 3, active: 22, recovery: 10, dmg: 2, hitstun: 12, blockstun: 8, push: 3, hitbox: { x: 40, w: 170, y: 300, h: 140 }, level: 'mid', multi: 6 },
      crouchPunch: { pose: 'g_upper', startup: 5, active: 6, recovery: 16, dmg: 7, hitstun: 22, blockstun: 12, push: 8, hitbox: { x: 0, w: 150, y: 250, h: 380 }, level: 'mid', kd: true, voice: 'g_hat', antiAir: true },
      crouchKick:  { anim: [['g_duck', 0], ['g_sweep', 6]], startup: 7, active: 6, recovery: 18, dmg: 7, hitstun: 20, blockstun: 12, push: 9, hitbox: { x: 30, w: 240, y: 0, h: 110 }, level: 'low', kd: true, voice: 'g_yap', hy: 60 },
      jumpAttack:  { pose: 'g_knee', startup: 4, active: 14, recovery: 4, dmg: 8, hitstun: 18, blockstun: 10, push: 8, hitbox: { x: 20, w: 150, y: 120, h: 220 }, level: 'high', voice: 'g_yap' },
    },
    commands: [
      { name: '고래빵 던지기', move: 'cmdToss', btn: 'p', motion: '236', easy: 'f', desc: '작은 고래빵이 날아가요' },
      { name: '로켓 어퍼', move: 'cmdUpper', btn: 'p', motion: '623', easy: 'df', desc: '뛰어오른 상대를 떨어뜨려요' },
      { name: '회전 킥', move: 'cmdSpin', btn: 'k', motion: '214', easy: 'b', desc: '빙글 돌면서 앞으로!' },
    ],
    rapid: { move: 'rapid', name: '연타 펀치' },
    specials: [
      // 9/29 연출 강화 (주인공이라 가장 화려하게): cine = game.js 의 CINE 연출 이름 · cutinF = 컷인 길이 · hold = 컷인 뒤 멈춘 연출 길이(프레임)
      { name: '고래빵 혼자 먹기', cutin: 'cutins/g1.webp', col: '#ffd23f', col2: '#7a3a00', voice: 'g_whale', voiceAt: 114, burstCol: ['#ffd000', '#ff3db4'], cine: 'whale', cutinF: 54, hold: 110,
        windupPose: 'g_charge', pre: [['g_charge', 0], ['g_bow', 54], ['g_charge', 142]], pose: 'g_special', dmg: 32, vfx: { type: 'custom', endT: 44, hitColor: 'rgb(255,200,60)' } },
      { name: '119 신고', cutin: 'cutins/g2.webp', col: '#ff5a6a', col2: '#1a2a8a', voice: 'g_call', voiceAt: 54, burstCol: ['#ff5a6a', '#2050ff'], cine: 'call119', cutinF: 54, hold: 96,
        windupPose: 'g_phone', pose: 'g_phone', dmg: 28, vfx: { type: 'siren', delay: 22, text: '119 신고 완료!', voice: 'g_119', hitColor: 'rgb(255,80,90)' } },
      { name: '부표 스매시', cutin: 'cutins/g3.webp', col: '#7fe8ff', col2: '#06305a', voice: 'g_buoy', voiceAt: 136, burstCol: ['#00f0ff', '#6a2cff'], cine: 'buoy', cutinF: 54, hold: 94,
        windupPose: 'g_windup', pose: 'g_throw', dmg: 36, vfx: { type: 'projectile', img: 'buoy', size: 560, speed: 30, y: 340, spin: true, hitColor: 'rgb(120,220,255)' } },
    ],
    voices: { intro: 'g_bow', attack: ['g_yap', 'g_hat', 'g_iyap'], hurt: ['g_hurt', 'g_ouch'], win: 'g_win', lose: 'g_what', taunt: 'g_easy', ko: 'g_hurt' },
    // 스테이지 시작 대사(없으면 생략) — 순서대로 [신불산, 영축산, 가지산]
    introLines: [null, { text: '산에서 불장난하면 안 돼요!', voice: 'g_nofire' }, null],
    endingAnswer: { text: '저요? 초등학생이에요!', voice: 'g_iamkid' },     // 엔딩 "근데 너, 몇 살이냐?" 에 대한 대답
  },

  // ------------------------------------------------------------ 산신령 (보스 · 2P 대전에서 선택 가능)
  sage: {
    name: '산신령', en: 'MOUNTAIN SPIRIT', age: '???세', tag: '여긴 내 산인데?',
    col: ['#19f5c8', '#ff2f8a'],
    face: 'roster/face_sage.jpg', vs: 'roster/vs_s.jpg', fight: 'roster/fight_s.jpg', fightCut: 'roster/fight_s_nukki.webp',
    portrait: { sx: 85, sy: 0, size: 660 },
    facing: -1, size: 1.4, boss: true,
    headH: 680,
    body: { hw: 105, h: 650, crouchH: 450 },
    speed: { walk: 5.5, back: 4.5, jumpV: 23, jumpX: 6, gravity: 1.2 },
    meterGain: 1,
    poses: {
      idle: 's_guard2', walk: 's_walk', jump: 's_run', crouch: 's_bow', guard: 's_block', crouchGuard: 's_bow',
      hit: 's_reel', crouchHit: 's_reel', down: 's_sit', ko: 's_hit', win: 's_comb', lose: 's_relax',
      intro: 's_bow', taunt: 's_flex', land: 's_guard2',
    },
    META: {
      s_guard2: { k: 1.2, ax: 244, ay: 1158 }, s_walk: { k: 1, ax: 303, ay: 1305 }, s_run: { k: 1.13, ax: 303, ay: 1227 },
      s_bow: { k: 1, ax: 372, ay: 1330 }, s_block: { k: 1.2, ax: 241, ay: 1161 }, s_reel: { k: 1.02, ax: 303, ay: 1325 },
      s_sit: { k: 1, ax: 420, ay: 1385 }, s_hit: { k: 1.2, ax: 393, ay: 1153 }, s_comb: { k: 1.04, ax: 295, ay: 1313 },
      s_relax: { k: 1.13, ax: 401, ay: 1335 }, s_flex: { k: .97, ax: 438, ay: 1335 }, s_beard: { k: .95, ax: 358, ay: 1352 },
      s_palm: { k: 1, ax: 465, ay: 1333 }, s_swing: { k: 1.2, ax: 556, ay: 1159 }, s_kick: { k: 1.02, ax: 425, ay: 1325 },
      s_hip: { k: 1, ax: 231, ay: 1333 }, s_belly: { k: 1, ax: 305, ay: 1333 }, s_stomp: { k: 1, ax: 353, ay: 1333 },
      s_power: { k: 1, ax: 267, ay: 1305 }, s_drink: { k: 1, ax: 258, ay: 1305 }, s_smash: { k: 1, ax: 306, ay: 1333 },
    },
    moves: {
      punch:  { pose: 's_palm',  startup: 7, active: 4, recovery: 12, dmg: 7,  hitstun: 18, blockstun: 11, push: 9,  hitbox: { x: 60, w: 230, y: 330, h: 150 }, level: 'mid', chain: 'punch2', links: { k: 'kick' }, voice: 's_hup' },
      punch2: { pose: 's_swing', startup: 8, active: 5, recovery: 20, dmg: 11, hitstun: 26, blockstun: 14, push: 16, hitbox: { x: 60, w: 330, y: 300, h: 180 }, level: 'mid', kd: true, big: 1.1 },
      kick:   { pose: 's_kick',  startup: 8, active: 5, recovery: 16, dmg: 8,  hitstun: 20, blockstun: 12, push: 10, hitbox: { x: 60, w: 210, y: 150, h: 170 }, level: 'mid', chain: 'kick2', voice: 's_hup' },
      kick2:  { pose: 's_hip',   startup: 7, active: 6, recovery: 20, dmg: 10, hitstun: 26, blockstun: 14, push: 18, hitbox: { x: 20, w: 170, y: 150, h: 300 }, level: 'mid', kd: true, big: 1.2, comboName: '산신령 삼단!' },
      crouchPunch: { pose: 's_belly', startup: 7, active: 6, recovery: 18, dmg: 8, hitstun: 22, blockstun: 12, push: 20, hitbox: { x: 30, w: 170, y: 150, h: 330 }, level: 'mid', kd: true, sfx: 'boing', popText: '뽀잉!', antiAir: true },
      crouchKick:  { pose: 's_stomp', startup: 10, active: 6, recovery: 20, dmg: 9, hitstun: 22, blockstun: 14, push: 10, hitbox: { x: 40, w: 300, y: 0, h: 110 }, level: 'low', kd: true, sfx: 'stomp', shock: true, hy: 60 },
      jumpAttack:  { pose: 's_kick', startup: 5, active: 14, recovery: 4, dmg: 9, hitstun: 18, blockstun: 10, push: 8, hitbox: { x: 30, w: 190, y: 60, h: 250 }, level: 'high', voice: 's_hup' },
      cmdPalm:  { anim: [['s_power', 0], ['s_palm', 10]], startup: 12, active: 6, recovery: 18, dmg: 8, hitstun: 22, blockstun: 14, push: 26, hitbox: { x: 60, w: 300, y: 250, h: 260 }, level: 'mid', big: 1.1, rings: true, voice: 's_hup', popText: '장풍!' },
      cmdBelly: { anim: [['s_bow', 0], ['s_belly', 8]], startup: 10, active: 8, recovery: 20, dmg: 9, hitstun: 24, blockstun: 14, push: 18, hitbox: { x: 20, w: 200, y: 150, h: 330 }, level: 'mid', kd: true, dash: 12, sfx: 'boing', popText: '뽀잉!' },
      cmdStomp: { anim: [['s_power', 0], ['s_stomp', 12]], startup: 14, active: 1, recovery: 24, wave: { speed: 13, dmg: 7, kd: true, col: '#c9a6ff' }, sfx: 'stomp', shock: true },
      cmdHip:   { anim: [['s_run', 0], ['s_hip', 8]], startup: 12, active: 10, recovery: 16, dmg: 10, hitstun: 24, blockstun: 16, push: 16, hitbox: { x: 10, w: 200, y: 100, h: 360 }, level: 'high', kd: true, hop: { vy: 15, vx: 6 }, big: 1.2, popText: '쿵!' },
    },
    commands: [
      { name: '장풍 손바닥', move: 'cmdPalm', btn: 'p', motion: '236', easy: 'f', desc: '멀리 밀어내요' },
      { name: '배치기', move: 'cmdBelly', btn: 'p', motion: '214', easy: 'b', desc: '배로 뽀잉! 돌진' },
      { name: '땅 울리기', move: 'cmdStomp', btn: 'k', motion: '214', easy: 'b', desc: '바닥 충격파 (앉아서 막기)' },
      { name: '엉덩이 찍기', move: 'cmdHip', btn: 'p', motion: '623', easy: 'df', desc: '뛰어서 쿵! (서서 막기)' },
    ],
    specials: [
      { name: '억새 회오리', cine: 'sage', cutin: 'cutins/s1.webp', col: '#c9a6ff', col2: '#3b1466', voice: 's_whirl', burstCol: ['#c9a6ff', '#3b1466'],
        windupPose: 's_power', pose: 's_power', dmg: 30, vfx: { type: 'whirl', speed: 11, hits: 4, hitColor: '#e8d8ff' } },
      { name: '도깨비불', cine: 'sage', cutin: 'cutins/s2.webp', col: '#7ff3ff', col2: '#063a4a', voice: 's_fire', burstCol: ['#7ff3ff', '#063a4a'],
        windupPose: 's_power', pose: 's_palm', dmg: 30, vfx: { type: 'multi', img: 'fire', size: 260, speed: 20, shots: [{ delay: 0, y: 120 }, { delay: 22, y: 470 }, { delay: 44, y: 300 }], hitColor: '#9ff5ff' } },
      { name: '구름 장풍', cine: 'sage', cutin: 'cutins/s3.webp', col: '#7fe3ff', col2: '#0b2a5a', voice: 's_cloud', burstCol: ['#7fe3ff', '#0b2a5a'],
        windupPose: 's_power', pose: 's_palm', dmg: 34, vfx: { type: 'projectile', img: 'cloud', size: 520, speed: 17, y: 380, hitColor: 'rgb(150,220,255)' } },
    ],
    voices: { intro: 's_intro', attack: ['s_hup'], hurt: ['s_hurt', 's_ah', 's_ang'], win: 's_haha', lose: 's_fizzle', taunt: 's_flex', ko: 's_hurt' },
    introLines: [{ text: '여긴 내 산인데?', voice: 's_intro' }, { text: '여긴 내 산인데?', voice: 's_intro' }, { text: '기다리고 있었다.', voice: 's_wait' }],
  },

  // ------------------------------------------------------------ 예술가 (다래)
  // 그림: sprites/a_*.png (여백 없이 잘라 낸 그림 → META 의 h = 화면에 보일 몸 높이(px)로 크기를 맞춤, ax/ay 는 자동)
  darae: {
    name: '예술가', en: 'ARTIST', age: '??세', tag: '마감 D-1, 잠 못 잠',
    signature: '"예술가 아무나 하냐?!" → "작업 마감!" 안경 던지기',
    extraVoices: ['a_nobody', 'a_keepdeadline', 'a_finishtoday', 'a_workdeadline'],   // 필살기 대사 (파일이 없으면 말풍선만 · "작업 마감!"은 a_deadline 으로 대신)
    // 필살기 첫 대사: 할 때마다 무작위 하나 (말풍선 글자 = 목소리)
    superLines: [{ text: '예술가 아무나 하냐?!', voice: 'a_nobody' }, { text: '마감은 지킨다!', voice: 'a_keepdeadline' }, { text: '오늘 안에 끝낸다!', voice: 'a_finishtoday' }],
    col: ['#ff2f8a', '#2a0a4a'],
    face: 'roster/face_darae.jpg', vs: null, fight: null, fightCut: 'roster/face_darae_nukki.webp',
    portrait: { sx: 150, sy: 60, size: 640 },
    facing: 1, size: 1, headH: 520,
    body: { hw: 72, h: 510, crouchH: 340 },
    speed: { walk: 7, back: 5.5, jumpV: 24, jumpX: 7, gravity: 1.25 },
    meterGain: 1,
    poses: {
      idle: 'a_idle', walk: 'a_walk', jump: 'a_jump', crouch: 'a_crouch', guard: 'a_guard', crouchGuard: 'a_crouch',
      hit: 'a_hit', crouchHit: 'a_crouch', down: 'a_down', ko: 'a_hit', win: 'a_win', lose: 'a_sp_dizzy',
      intro: 'a_bow', taunt: 'a_taunt', land: 'a_crouch',
    },
    META: {
      a_idle: { h: 520, flip: true }, a_walk: { h: 525 }, a_jump: { h: 470 }, a_crouch: { h: 430, flip: true }, a_guard: { h: 470, flip: true }, a_hit: { h: 520 },
      a_down: { h: 115 }, a_win: { h: 620 }, a_sp_dizzy: { h: 380 }, a_bow: { h: 470 }, a_taunt: { h: 540, flip: true },
      a_punch: { h: 500 }, a_punch2: { h: 480 }, a_kick: { h: 560 }, a_upper: { h: 600 }, a_jumpatk: { h: 440 },
      a_sp_windup: { h: 600 }, a_sp_shout: { h: 530 }, a_sp_swing: { h: 520, flip: true },
      a_sp_deadline: { h: 540 }, a_sp_glasses: { h: 540, flip: true }, a_sp_throw: { h: 410 },   // 필살기 "작업 마감!" 안경 던지기 (9/29 재디자인 h 반영: darae_redesign_meta_0929.json)
    },
    moves: {
      punch:  { pose: 'a_punch', startup: 5, active: 4, recovery: 10, dmg: 5, hitstun: 16, blockstun: 10, push: 7, hitbox: { x: 40, w: 190, y: 300, h: 130 }, level: 'mid', chain: 'punch2', links: { k: 'kick' } },
      punch2: { pose: 'a_punch2', startup: 5, active: 5, recovery: 16, dmg: 8, hitstun: 24, blockstun: 12, push: 12, hitbox: { x: 40, w: 180, y: 220, h: 200 }, level: 'mid', kd: true, big: 1.1, popText: '탁!' },
      kick:   { pose: 'a_kick', startup: 8, active: 5, recovery: 15, dmg: 8, hitstun: 20, blockstun: 12, push: 10, hitbox: { x: 50, w: 200, y: 250, h: 180 }, level: 'mid', links: { p: 'crouchPunch' } },
      crouchPunch: { pose: 'a_upper', startup: 6, active: 6, recovery: 16, dmg: 7, hitstun: 22, blockstun: 12, push: 8, hitbox: { x: 0, w: 150, y: 250, h: 380 }, level: 'mid', kd: true, antiAir: true, comboName: '마감 삼단!' },
      crouchKick:  { anim: [['a_crouch', 0], ['a_sp_swing', 6]], startup: 7, active: 6, recovery: 18, dmg: 7, hitstun: 20, blockstun: 12, push: 9, hitbox: { x: 30, w: 270, y: 180, h: 160 }, level: 'mid', kd: true },
      jumpAttack:  { pose: 'a_jumpatk', startup: 4, active: 14, recovery: 4, dmg: 8, hitstun: 18, blockstun: 10, push: 8, hitbox: { x: 20, w: 170, y: 120, h: 220 }, level: 'high' },
      cmdLaptop: { anim: [['a_punch', 0], ['a_punch2', 8]], startup: 10, active: 7, recovery: 18, dmg: 9, hitstun: 22, blockstun: 14, push: 14, hitbox: { x: 30, w: 220, y: 220, h: 220 }, level: 'mid', kd: true, dash: 11, big: 1.1, popText: '탁!' },
      cmdShout:  { anim: [['a_taunt', 0], ['a_sp_shout', 8]], startup: 10, active: 8, recovery: 22, dmg: 5, hitstun: 40, blockstun: 16, push: 6, hitbox: { x: 40, w: 330, y: 200, h: 320 }, level: 'mid', rings: true, popText: '아아아!' },
      cmdShovel: { anim: [['a_sp_windup', 0], ['a_sp_swing', 12]], startup: 14, active: 8, recovery: 16, dmg: 11, hitstun: 24, blockstun: 16, push: 14, hitbox: { x: 30, w: 240, y: 60, h: 360 }, level: 'high', kd: true, hop: { vy: 16, vx: 7 }, big: 1.2 },
    },
    commands: [
      { name: '노트북 휘두르기', move: 'cmdLaptop', btn: 'p', motion: '236', easy: 'f', desc: '앞으로 나가며 탁!' },
      { name: '확성기 샤우트', move: 'cmdShout', btn: 'p', motion: '623', easy: 'df', desc: '가까운 상대가 한동안 멍~' },
      { name: '점프 삽', move: 'cmdShovel', btn: 'k', motion: '214', easy: 'b', desc: '뛰어서 내려찍기 (서서 막기)' },
    ],
    specials: [
      // 초필살기 "작업 마감!" (9/29): "예술가 아무나 하냐?!" → "작업 마감!" + D-0 도장 · 원고 소용돌이 → 안경 벗기 슬로모션 클로즈업 → 던진 안경이 맞고 "마감 완료!" 도장 + 종이 폭발
      //  3판은 커다란 안경이 맞고 지나갔다가 되돌아오며 한 번 더(loops: 2)
      { name: '작업 마감!', cutin: 'cutins/a2.webp', col: '#ff2f8a', col2: '#2a0a4a', voice: null, voiceAt: -1, glintAt: 184, cine: 'deadline', cutinF: 54, hold: 150, burstCol: ['#ff2f8a', '#ffe600'],
        windupPose: 'a_sp_deadline', pre: [['a_sp_deadline', 0], ['a_sp_glasses', 162]], pose: 'a_sp_throw', anim: [['a_sp_throw', 0]], dmg: 30,
        vfx: { type: 'glasses', at: 2, size: 260, speed: 24, y: 330, hitColor: '#ff7ac0' } },
      { name: '작업 마감! 부메랑', cutin: 'cutins/a3.webp', col: '#ffd23f', col2: '#3a1400', voice: null, voiceAt: -1, glintAt: 184, cine: 'deadline', cutinF: 54, hold: 150, burstCol: ['#ffd23f', '#ff2f8a'],
        windupPose: 'a_sp_deadline', pre: [['a_sp_deadline', 0], ['a_sp_glasses', 162]], pose: 'a_sp_throw', anim: [['a_sp_throw', 0]], dmg: 31,
        vfx: { type: 'glasses', at: 2, size: 330, speed: 25, y: 340, hitColor: '#ffd23f' } },
      { name: '작업 마감! 대왕 안경', cutin: 'cutins/a2.webp', col: '#7fe8ff', col2: '#06305a', voice: null, voiceAt: -1, glintAt: 184, cine: 'deadline', cutinF: 54, hold: 150, burstCol: ['#7fe8ff', '#6a2cff'],
        windupPose: 'a_sp_deadline', pre: [['a_sp_deadline', 0], ['a_sp_glasses', 162]], pose: 'a_sp_throw', anim: [['a_sp_throw', 0]], dmg: 34,
        vfx: { type: 'glasses', at: 2, size: 440, speed: 23, y: 350, loops: 2, hitColor: '#7fe8ff' } },
    ],
    voices: { intro: null, attack: [], hurt: [], win: null, lose: null },
    introLines: [null, null, null],
    endingAnswer: { text: '비밀이에요~', voice: null },
  },

  // ------------------------------------------------------------ 군인
  soldier: {
    name: '군인', en: 'SOLDIER', age: '21세', tag: '휴가 첫날',
    signature: '"충성!" 경례하고 탕탕탕',
    col: ['#d8ff5a', '#3a5010'],
    face: 'roster/face_soldier.jpg', vs: null, fight: null, fightCut: 'roster/face_soldier_nukki.webp',
    portrait: { sx: 170, sy: 80, size: 650 },
    facing: 1, size: 1, headH: 550,
    body: { hw: 75, h: 540, crouchH: 360 },
    speed: { walk: 7, back: 5.5, jumpV: 24, jumpX: 7, gravity: 1.25 },
    meterGain: 1,
    poses: {
      idle: 'm_idle', walk: 'm_walk', jump: 'm_jump', crouch: 'm_crouch', guard: 'm_guard', crouchGuard: 'm_crouch',
      hit: 'm_hit', crouchHit: 'm_crouch', down: 'm_down', ko: 'm_hit', win: 'm_win', lose: 'm_bow',
      intro: 'm_bow', taunt: 'm_taunt', land: 'm_crouch',
    },
    META: {
      m_idle: { h: 537 }, m_walk: { h: 539 }, m_jump: { h: 465 }, m_crouch: { h: 412, flip: true }, m_guard: { h: 546 }, m_hit: { h: 561 },
      m_down: { h: 192 }, m_win: { h: 668 }, m_bow: { h: 443 }, m_taunt: { h: 575 },
      m_punch: { h: 534 }, m_punch2: { h: 528 }, m_kick: { h: 563 }, m_upper: { h: 623 }, m_sweep: { h: 274 },
      m_sp_windup: { h: 556 }, m_sp_charge: { h: 407 }, m_sp_slam: { h: 488 },
      m_sp_salute: { h: 575 }, m_sp_aim: { h: 534 }, m_sp_fire: { h: 532 },   // 필살기 "충성!" 사격
    },
    moves: {
      punch:  { pose: 'm_punch', startup: 5, active: 4, recovery: 10, dmg: 6, hitstun: 16, blockstun: 10, push: 7, hitbox: { x: 40, w: 180, y: 330, h: 130 }, level: 'mid', chain: 'punch2', links: { k: 'kick' } },
      punch2: { pose: 'm_punch2', startup: 5, active: 5, recovery: 16, dmg: 8, hitstun: 24, blockstun: 12, push: 12, hitbox: { x: 40, w: 190, y: 300, h: 160 }, level: 'mid', kd: true, big: 1.1 },
      kick:   { pose: 'm_kick', startup: 8, active: 5, recovery: 15, dmg: 8, hitstun: 20, blockstun: 12, push: 10, hitbox: { x: 60, w: 210, y: 250, h: 180 }, level: 'mid', links: { p: 'crouchPunch' } },
      crouchPunch: { pose: 'm_upper', startup: 6, active: 6, recovery: 16, dmg: 7, hitstun: 22, blockstun: 12, push: 8, hitbox: { x: 0, w: 150, y: 250, h: 400 }, level: 'mid', kd: true, antiAir: true, comboName: '군대식 삼단!' },
      crouchKick:  { anim: [['m_crouch', 0], ['m_sweep', 6]], startup: 7, active: 6, recovery: 18, dmg: 7, hitstun: 20, blockstun: 12, push: 9, hitbox: { x: 30, w: 260, y: 0, h: 110 }, level: 'low', kd: true, hy: 60 },
      jumpAttack:  { pose: 'm_kick', startup: 4, active: 14, recovery: 4, dmg: 8, hitstun: 18, blockstun: 10, push: 8, hitbox: { x: 20, w: 190, y: 120, h: 220 }, level: 'high' },
      cmdDash:   { anim: [['m_sp_windup', 0], ['m_sp_charge', 8]], startup: 10, active: 10, recovery: 18, dmg: 10, hitstun: 24, blockstun: 14, push: 16, hitbox: { x: 30, w: 220, y: 250, h: 220 }, level: 'mid', kd: true, dash: 17, big: 1.1 },
      cmdSweep:  { anim: [['m_crouch', 0], ['m_sweep', 5]], startup: 8, active: 10, recovery: 20, dmg: 8, hitstun: 20, blockstun: 12, push: 9, hitbox: { x: 20, w: 280, y: 0, h: 120 }, level: 'low', kd: true, dash: 12, hy: 60 },
      cmdSalute: { pose: 'm_taunt', startup: 18, active: 1, recovery: 22, meter: 25, popStart: '충성!' },
    },
    commands: [
      { name: '돌격 대시', move: 'cmdDash', btn: 'p', motion: '236', easy: 'f', desc: '빠르게 달려가 한 방' },
      { name: '다리 쓸기', move: 'cmdSweep', btn: 'k', motion: '214', easy: 'b', desc: '미끄러지며 발 걸기 (앉아서 막기)' },
      { name: '경례', move: 'cmdSalute', btn: 'p', motion: '214', easy: 'b', desc: 'SUPER 게이지가 쑥 차요' },
    ],
    specials: [
      // 대표 필살기: 경례하며 "충성!" → 만화 총을 겨눠 탕탕탕 (둥근 총구 불꽃 · 캡슐 총알 · 마지막 발에 넉백). 피 없음 · 방사형 광선 없음
      // 9/29 연출: 경례 "충성!" → 겨누기 → 총알 시간(slowFrom 번째 총알부터 아주 느리게, 카메라가 총알을 따라감) → "팡!" 원래 속도로
      { name: '충성! 사격', cutin: 'cutins/m2.webp', col: '#d8ff5a', col2: '#3a5010', voice: 'm_salute', voiceAt: 60, shout: '충성!', hold: 40, cutinF: 60, cine: 'gun', burstCol: ['#d8ff5a', '#3a5010'],
        windupPose: 'm_sp_salute', pre: [['m_sp_salute', 0], ['m_sp_aim', 88]], pose: 'm_sp_fire', anim: [['m_sp_aim', 0]], dmg: 30,
        vfx: { type: 'gun', aimPose: 'm_sp_aim', at: 8, shots: 3, gap: 9, slowFrom: 2, speed: 38, size: 110, mx: 262, y: 450, lastBig: 1.5, hitColor: '#ffd23f' } },
      { name: '충성! 연속 사격', cutin: 'cutins/m3.webp', col: '#ffb347', col2: '#3a5010', voice: 'm_salute', voiceAt: 60, shout: '충성!', hold: 40, cutinF: 60, cine: 'gun', burstCol: ['#ffb347', '#3a5010'],
        windupPose: 'm_sp_salute', pre: [['m_sp_salute', 0], ['m_sp_aim', 88]], pose: 'm_sp_fire', anim: [['m_sp_aim', 0]], dmg: 31,
        vfx: { type: 'gun', aimPose: 'm_sp_aim', at: 8, shots: 5, gap: 7, slowFrom: 3, gapSlow: 4, speed: 40, size: 110, mx: 262, y: 450, lastBig: 1.7, hitColor: '#ffb347' } },
      { name: '충성! 대포알 사격', cutin: 'cutins/m2.webp', col: '#d8ff5a', col2: '#ff2f8a', voice: 'm_salute', voiceAt: 60, shout: '충성!!', hold: 40, cutinF: 60, cine: 'gun', burstCol: ['#d8ff5a', '#ff2f8a'],
        windupPose: 'm_sp_salute', pre: [['m_sp_salute', 0], ['m_sp_aim', 88]], pose: 'm_sp_fire', anim: [['m_sp_aim', 0]], dmg: 34,
        vfx: { type: 'gun', aimPose: 'm_sp_aim', at: 8, shots: 5, gap: 7, slowFrom: 2, gapSlow: 4, speed: 40, size: 120, mx: 262, y: 450, lastBig: 2.6, hitColor: '#d8ff5a' } },
    ],
    voices: { intro: null, attack: [], hurt: [], win: null, lose: null },
    introLines: [null, null, null],
    endingAnswer: { text: '스물한 살입니다!', voice: null },
  },
  // ------------------------------------------------------------ 직장인 (울산 공단 12년차)
  // 그림: sprites/w_*.png (여백 둔 투명 PNG, META 의 h = 화면에 보일 몸 높이) · 효과 그림: vfx/w_coin·w_bills·w_bag·w_storm.png
  // 필살기 "월급 입금!": 휴대폰 진동·띵동 → 입금 알림 창 → "월급 입금!" 외치고 → 지폐·동전 폭풍 (둥근 동전·가로 속도선만, 방사형 광선 없음)
  worker: {
    name: '직장인', en: 'WORKER', age: '42세', tag: '울산 공단 12년차',
    col: ['#5ab8ff', '#16307a'],
    face: 'roster/face_worker.jpg', vs: null, fight: null, fightCut: 'roster/face_worker_nukki.webp',
    portrait: { sx: 190, sy: 40, size: 640 },
    signature: '휴대폰 띵동! "월급 입금!" 돈 폭풍',
    facing: 1, size: 1, headH: 560,
    body: { hw: 78, h: 540, crouchH: 360 },
    speed: { walk: 6.8, back: 5.3, jumpV: 24, jumpX: 7, gravity: 1.25 },
    meterGain: 1,
    poses: {
      idle: 'w_idle', walk: 'w_walk', jump: 'w_jump', crouch: 'w_crouch', guard: 'w_guard', crouchGuard: 'w_crouch',
      hit: 'w_hit', crouchHit: 'w_crouch', down: 'w_down', ko: 'w_hit', win: 'w_win', lose: 'w_lose',
      intro: 'w_bow', taunt: 'w_taunt', land: 'w_crouch',
    },
    META: {
      w_idle: { h: 545 }, w_walk: { h: 550 }, w_jump: { h: 470 }, w_crouch: { h: 400 }, w_guard: { h: 520 }, w_hit: { h: 560 },
      w_down: { h: 190 }, w_win: { h: 620 }, w_lose: { h: 360 }, w_bow: { h: 470 }, w_taunt: { h: 560 },
      w_punch: { h: 540 }, w_punch2: { h: 540 }, w_kick: { h: 540 }, w_upper: { h: 620 }, w_jumpatk: { h: 480 }, w_sweep: { h: 330 },
      w_headbutt: { h: 470 }, w_towel: { h: 540 }, w_wrench: { h: 600 }, w_phone: { h: 545 }, w_power: { h: 560 }, w_joy: { h: 620 }, w_throw: { h: 520 },
    },
    moves: {
      punch:  { pose: 'w_punch', startup: 5, active: 4, recovery: 10, dmg: 6, hitstun: 16, blockstun: 10, push: 7, hitbox: { x: 40, w: 190, y: 330, h: 130 }, level: 'mid', chain: 'punch2', links: { k: 'kick' }, voice: 'w_hup' },
      punch2: { pose: 'w_punch2', startup: 5, active: 5, recovery: 16, dmg: 8, hitstun: 24, blockstun: 12, push: 12, hitbox: { x: 40, w: 180, y: 300, h: 170 }, level: 'mid', kd: true, big: 1.1, voice: 'w_hup2' },
      kick:   { pose: 'w_kick', startup: 8, active: 5, recovery: 15, dmg: 8, hitstun: 20, blockstun: 12, push: 10, hitbox: { x: 50, w: 210, y: 200, h: 180 }, level: 'mid', links: { p: 'crouchPunch' }, voice: 'w_yeong' },
      crouchPunch: { pose: 'w_upper', startup: 6, active: 6, recovery: 16, dmg: 7, hitstun: 22, blockstun: 12, push: 8, hitbox: { x: 0, w: 150, y: 250, h: 400 }, level: 'mid', kd: true, antiAir: true, comboName: '정시 퇴근 삼단!' },
      crouchKick:  { anim: [['w_crouch', 0], ['w_sweep', 6]], startup: 7, active: 6, recovery: 18, dmg: 7, hitstun: 20, blockstun: 12, push: 9, hitbox: { x: 30, w: 270, y: 0, h: 110 }, level: 'low', kd: true, hy: 60 },
      jumpAttack:  { pose: 'w_jumpatk', startup: 4, active: 14, recovery: 4, dmg: 8, hitstun: 18, blockstun: 10, push: 8, hitbox: { x: 20, w: 200, y: 100, h: 220 }, level: 'high', voice: 'w_hup' },
      // 기술
      cmdHelmet: { anim: [['w_crouch', 0], ['w_headbutt', 8]], startup: 10, active: 9, recovery: 18, dmg: 10, hitstun: 24, blockstun: 14, push: 16, hitbox: { x: 20, w: 200, y: 300, h: 200 }, level: 'mid', kd: true, dash: 14, big: 1.1, popText: '안전 제일!', voice: 'w_yeong' },
      cmdTowel:  { anim: [['w_taunt', 0], ['w_towel', 9]], startup: 11, active: 10, recovery: 18, dmg: 8, hitstun: 22, blockstun: 12, push: 14, hitbox: { x: 40, w: 340, y: 280, h: 160 }, level: 'mid', multi: 5, popText: '휘릭!', voice: 'w_hup2' },
      cmdWrench: { anim: [['w_crouch', 0], ['w_wrench', 4]], startup: 5, active: 10, recovery: 22, dmg: 10, hitstun: 24, blockstun: 14, push: 10, hitbox: { x: 0, w: 190, y: 200, h: 460 }, level: 'mid', kd: true, hop: { vy: 14, vx: 3 }, invul: 8, antiAir: true, big: 1.1, popText: '깡!', voice: 'w_hup' },
    },
    commands: [
      { name: '안전모 박치기', move: 'cmdHelmet', btn: 'p', motion: '236', easy: 'f', desc: '안전모 쓰고 돌진!' },
      { name: '스패너 올려치기', move: 'cmdWrench', btn: 'p', motion: '623', easy: 'df', desc: '뛰어오른 상대를 깡!' },
      { name: '수건 휘두르기', move: 'cmdTowel', btn: 'k', motion: '214', easy: 'b', desc: '길게 휘릭! 여러 번 맞음' },
    ],
    // 필살기 "월급 입금!" — 경기장마다 맛이 조금씩 다름 [신불산, 영축산, 가지산]
    specials: [
      { name: '월급 입금', cutin: 'cutins/w1.webp', col: '#ffd23f', col2: '#16307a', voice: 'w_payday', voiceAt: 100, shout: '월급 입금!', hold: 60, cine: 'payday', burstCol: ['#ffd23f', '#5ab8ff'],
        notify: { title: '공단은행', text: '월급이 입금되었습니다', voice: 'w_ding', at: 1.22, life: 1.25 }, fireVoice: 'w_coins',
        windupPose: 'w_phone', pre: [['w_phone', 0], ['w_power', 98]], pose: 'w_throw', anim: [['w_throw', 0]], dmg: 30,
        vfx: { type: 'multi', img: 'w_bills', size: 300, speed: 24, coins: true, shots: [{ delay: 0, y: 330 }, { delay: 9, y: 470, img: 'w_storm' }, { delay: 18, y: 200 }, { delay: 27, y: 400, img: 'w_storm' }], hitColor: '#ffd23f' } },
      { name: '월급+보너스 입금', cutin: 'cutins/w2.webp', col: '#ffd23f', col2: '#7a3a00', voice: 'w_payday', voiceAt: 100, shout: '보너스까지!', hold: 60, cine: 'payday', burstCol: ['#ffd23f', '#ff9d00'],
        notify: { title: '공단은행', text: '월급+보너스가 입금되었습니다', voice: 'w_ding', at: 1.22, life: 1.25 }, fireVoice: 'w_coins',
        windupPose: 'w_phone', pre: [['w_phone', 0], ['w_joy', 98]], pose: 'w_throw', anim: [['w_throw', 0]], dmg: 30,
        vfx: { type: 'projectile', img: 'w_coin', size: 520, speed: 22, y: 330, spin: true, coins: true, hitColor: '#ffd23f' } },
      { name: '월급+성과급 입금', cutin: 'cutins/w3.webp', col: '#9be07a', col2: '#16307a', voice: 'w_payday', voiceAt: 100, shout: '성과급까지!!', hold: 60, cine: 'payday', burstCol: ['#9be07a', '#ffd23f'],
        notify: { title: '공단은행', text: '월급+성과급이 입금되었습니다', voice: 'w_ding', at: 1.22, life: 1.25 }, fireVoice: 'w_coins',
        windupPose: 'w_phone', pre: [['w_phone', 0], ['w_power', 98]], pose: 'w_throw', anim: [['w_throw', 0]], dmg: 34,
        vfx: { type: 'multi', img: 'w_bills', size: 300, speed: 24, coins: true, shots: [{ delay: 0, y: 420, img: 'w_storm' }, { delay: 10, y: 220 }, { delay: 22, y: 330, img: 'w_bag', size: 460, speed: 20 }], hitColor: '#9be07a' } },
    ],
    voices: { intro: 'w_intro', attack: ['w_hup', 'w_hup2', 'w_yeong'], hurt: ['w_hurt', 'w_ugh'], win: 'w_win', lose: 'w_lose', taunt: 'w_taunt', ko: 'w_hurt' },
    introLines: [{ text: '안전 제일! 한 판 붙어 봅시다!', voice: 'w_intro' }, { text: '퇴근 시간 다 됐다!', voice: 'w_taunt' }, { text: '안전 제일! 한 판 붙어 봅시다!', voice: 'w_intro' }],
    endingAnswer: { text: '마흔둘! 공단 12년차요!', voice: 'w_ending42' },   // 9/29 나이 42세로. w_ending42.mp3 가 생기면 나옴(없으면 말풍선만 — 예전 w_ending.mp3 는 "서른여덟"이라 안 씀)
  },
};

// 선택 화면 칸 순서 (select.html 과 같음). key 가 CHARACTERS 에 없거나 그림이 다 없으면 자물쇠 + "준비중"
window.ROSTER = [
  { key: 'chodding', face: 'roster/face_chodding.jpg', name: '초딩', en: 'CHODING', age: '9세', tag: '산을 지키는 꼬마', col: ['#ffe600', '#7b2cff'] },
  { key: 'student', face: 'roster/face_student.jpg', name: '대학생', en: 'STUDENT', age: '22세', tag: '밤샘 과제 3일째', col: ['#9dff5a', '#1f6a3a'] },
  { key: 'parttime', face: 'roster/face_parttime.jpg', name: '알바생', en: 'PART-TIMER', age: '28세', tag: '편의점 야간 근무', col: ['#5affc8', '#0a5a5a'] },
  { key: 'worker', face: 'roster/face_worker.jpg', name: '직장인', en: 'WORKER', age: '42세', tag: '울산 공단 12년차', col: ['#5ab8ff', '#16307a'] },
  { key: 'soldier', face: 'roster/face_soldier.jpg', name: '군인', en: 'SOLDIER', age: '21세', tag: '휴가 첫날', col: ['#d8ff5a', '#3a5010'] },
  { key: 'middle', face: 'roster/face_middle.jpg', name: '중년', en: 'MIDDLE-AGE', age: '58세', tag: '주말 산악회 회장', col: ['#ffb347', '#a02a00'] },
  { key: 'grandma', face: 'roster/face_grandma.jpg', name: '노인', en: 'GRANDMA', age: '80세', tag: '영남알프스 9봉 완등', col: ['#ff8ad0', '#7a1a5a'] },
  { key: 'darae', face: 'roster/face_darae.jpg', name: '예술가', en: 'ARTIST', age: '??세', tag: '마감 D-1, 잠 못 잠', col: ['#ff2f8a', '#2a0a4a'] },
];
window.BOSS_KEY = 'sage';

window.STAGES = [
  { bg: 'bg.jpg', round: 'ROUND 1', place: '신불산', filter: 'none', announce: 'a_round1', ai: 1 },
  { bg: 'bg_r2.jpg', round: 'ROUND 2', place: '영축산', filter: 'brightness(.78) saturate(.92)', fire: { x: 1430, y: 770 }, floorDark: .5, announce: 'a_round2', ai: 2 },
  { bg: 'bg_r3.jpg', round: 'FINAL ROUND', place: '가지산', filter: 'brightness(.95) saturate(1.05) sepia(.08)', mist: true, announce: 'a_final', ai: 3 },
];
