/** Canvas minijuegos: piano, rhythm, bullet, flappy, snake, breakout */
(function () {
  'use strict';

  let deps = null;
  let gameId = null;
  let session = null;
  let zoneMeta = null;
  let running = false;
  let raf = null;
  let score = 0;
  let endAt = 0;
  let canvas = null;
  let ctx = null;
  let liveTimer = null;
  let keyHandler = null;

  const LANES = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
  let pianoNotes = [];
  let pianoSpeed = 5;
  let pianoSpawnAt = 0;

  let rhythmNext = 0;
  let rhythmWindow = 0;
  let rhythmRing = 1;

  let heart = { x: 110, y: 110 };
  let bullets = [];
  let bulletSpawnAt = 0;
  let bulletKeys = {};

  let flappyBird = { y: 110, vy: 0, grav: 0.32, flap: -5.2 };
  let flappyPipes = [];
  let flappySpawnAt = 0;
  let flappyDead = false;

  const SNAKE_CELLS = 14;
  let snakeBody = [];
  let snakeDir = { x: 1, y: 0 };
  let snakeNextDir = { x: 1, y: 0 };
  let snakeFood = { x: 5, y: 5 };
  let snakeTickAt = 0;
  let snakeAlive = true;

  let breakoutPaddle = 96;
  let breakoutBall = { x: 110, y: 180, vx: 2.4, vy: -2.8, r: 4 };
  let breakoutBricks = [];
  let breakoutKeys = {};

  const CANVAS_W = 360;
  const CANVAS_H = 420;
  const BASE = 220;

  function gw() { return canvas?.width || CANVAS_W; }
  function gh() { return canvas?.height || CANVAS_H; }
  function sx(v) { return (v / BASE) * gw(); }
  function sy(v) { return (v / BASE) * gh(); }
  function su(v) { return v * Math.min(gw(), gh()) / BASE; }

  function fitCanvas() {
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
  }

  function $(id) { return document.getElementById(id); }

  function isOpen() {
    const o = $('arcade-game-overlay');
    return o && !o.hidden;
  }

  function fmtCoins(n) {
    if (typeof NumberFormat !== 'undefined') {
      return NumberFormat.formatCompact(n, { threshold: 1_000_000, digits: 2 });
    }
    return String(n);
  }

  async function pingLive() {
    if (!session || !deps?.getUser?.()) return;
    try {
      await fetch('/api/minigame/live/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          zoneId: zoneMeta?.zone?.id || '',
          score,
          x: zoneMeta?.zone?.x ?? 0,
          y: zoneMeta?.zone?.y ?? 0,
        }),
      });
    } catch (_) { /* ignore */ }
  }

  function setHud(title, scoreVal, timeLeft) {
    const t = $('arcade-game-title');
    const s = $('arcade-game-score');
    const tm = $('arcade-game-timer');
    if (t) t.textContent = title || '';
    if (s) s.textContent = String(scoreVal);
    if (tm) tm.textContent = `${Math.max(0, timeLeft)}s`;
  }

  function resetState(id) {
    score = 0;
    pianoNotes = [];
    pianoSpawnAt = 0;
    rhythmNext = performance.now() + 600;
    rhythmWindow = 0;
    rhythmRing = 1;
    heart = { x: sx(110), y: sy(110) };
    bullets = [];
    bulletSpawnAt = 0;
    bulletKeys = {};
    flappyBird = { y: sy(110), vy: 0, grav: sy(0.32), flap: sy(-5.2) };
    flappyPipes = [];
    flappySpawnAt = performance.now() + 900;
    flappyDead = false;
    snakeBody = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
    snakeDir = { x: 1, y: 0 };
    snakeNextDir = { x: 1, y: 0 };
    snakeFood = { x: 10, y: 7 };
    snakeTickAt = 0;
    snakeAlive = true;
    breakoutPaddle = sx(96);
    breakoutBall = { x: sx(110), y: sy(180), vx: su(2.4), vy: su(-2.8), r: su(4) };
    breakoutBricks = [];
    breakoutKeys = {};
    if (id === 'piano') pianoSpeed = su(5);
    if (id === 'breakout') initBreakoutBricks();
  }

  function initBreakoutBricks() {
    breakoutBricks = [];
    const rows = 5;
    const padX = sx(6);
    const padY = sy(6);
    const gapX = sx(2);
    const gapY = sy(2);
    const bw = sx(24);
    const bh = sy(10);
    const cols = Math.max(8, Math.floor((gw() - padX * 2 + gapX) / (bw + gapX)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        breakoutBricks.push({
          x: padX + c * (bw + gapX),
          y: padY + r * (bh + gapY),
          w: bw,
          h: bh,
          alive: true,
        });
      }
    }
  }

  function spawnFlappyPipe() {
    const gap = sy(58);
    const topH = sy(28) + Math.random() * sy(90);
    flappyPipes.push({ x: gw() + su(20), topH, gap, scored: false });
  }

  function placeSnakeFood() {
    const occupied = new Set(snakeBody.map((s) => `${s.x},${s.y}`));
    for (let i = 0; i < 80; i++) {
      const fx = Math.floor(Math.random() * SNAKE_CELLS);
      const fy = Math.floor(Math.random() * SNAKE_CELLS);
      if (!occupied.has(`${fx},${fy}`)) {
        snakeFood = { x: fx, y: fy };
        return;
      }
    }
  }

  function snakeTurn(dx, dy) {
    if (dx === -snakeDir.x && dy === -snakeDir.y) return;
    snakeNextDir = { x: dx, y: dy };
  }

  function tickSnake() {
    if (!snakeAlive) return;
    snakeDir = snakeNextDir;
    const head = snakeBody[0];
    const nx = head.x + snakeDir.x;
    const ny = head.y + snakeDir.y;
    if (nx < 0 || ny < 0 || nx >= SNAKE_CELLS || ny >= SNAKE_CELLS) {
      snakeAlive = false;
      return;
    }
    const willGrow = nx === snakeFood.x && ny === snakeFood.y;
    const checkLen = willGrow ? snakeBody.length : Math.max(0, snakeBody.length - 1);
    for (let i = 0; i < checkLen; i++) {
      const s = snakeBody[i];
      if (s.x === nx && s.y === ny) {
        snakeAlive = false;
        return;
      }
    }
    snakeBody.unshift({ x: nx, y: ny });
    if (nx === snakeFood.x && ny === snakeFood.y) {
      score += 1;
      placeSnakeFood();
    } else {
      snakeBody.pop();
    }
  }

  function flappyFlap() {
    if (flappyDead) {
      flappyDead = false;
      flappyBird.y = sy(110);
      flappyBird.vy = 0;
      flappyPipes = [];
      flappySpawnAt = performance.now() + 800;
      return;
    }
    flappyBird.vy = flappyBird.flap;
  }

  function spawnPianoNote() {
    pianoNotes.push({
      lane: Math.floor(Math.random() * 4),
      y: -su(24),
      hit: false,
    });
  }

  function spawnBullet() {
    const side = Math.floor(Math.random() * 4);
    const w = gw();
    const h = gh();
    let x = 0; let y = 0; let vx = 0; let vy = 0;
    const sp = su(2.2 + Math.random() * 1.8);
    const off = su(6);
    if (side === 0) { x = Math.random() * w; y = -off; vy = sp; }
    else if (side === 1) { x = w + off; y = Math.random() * h; vx = -sp; }
    else if (side === 2) { x = Math.random() * w; y = h + off; vy = -sp; }
    else { x = -off; y = Math.random() * h; vx = sp; }
    bullets.push({ x, y, vx, vy, r: su(4) });
  }

  function pianoHit(lane) {
    const hitY = gh() * 0.82;
    let best = null;
    let bestD = 999;
    for (const n of pianoNotes) {
      if (n.hit || n.lane !== lane) continue;
      const d = Math.abs(n.y - hitY);
      if (d < sy(36) && d < bestD) { best = n; bestD = d; }
    }
    if (best) {
      best.hit = true;
      score += 1;
    }
  }

  function rhythmHit() {
    if (!rhythmWindow) return;
    const d = Math.abs(performance.now() - rhythmWindow);
    if (d < 130) {
      score += 1;
      rhythmRing = 1;
    }
    rhythmWindow = 0;
  }

  function onKeyDown(e) {
    if (!running) return;
    if (gameId === 'piano' && LANES.includes(e.code)) {
      e.preventDefault();
      pianoHit(LANES.indexOf(e.code));
    }
    if (gameId === 'rhythm' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      rhythmHit();
    }
    if (gameId === 'bullet') {
      bulletKeys[e.code] = true;
    }
    if (gameId === 'flappy' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      flappyFlap();
    }
    if (gameId === 'snake') {
      if (e.code === 'ArrowUp') { e.preventDefault(); snakeTurn(0, -1); }
      if (e.code === 'ArrowDown') { e.preventDefault(); snakeTurn(0, 1); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); snakeTurn(-1, 0); }
      if (e.code === 'ArrowRight') { e.preventDefault(); snakeTurn(1, 0); }
    }
    if (gameId === 'breakout') {
      breakoutKeys[e.code] = true;
    }
  }

  function onKeyUp(e) {
    if (gameId === 'bullet') bulletKeys[e.code] = false;
    if (gameId === 'breakout') breakoutKeys[e.code] = false;
  }

  function updateBullet(now) {
    const spd = su(2.8);
    if (bulletKeys.ArrowLeft || bulletKeys.KeyA) heart.x -= spd;
    if (bulletKeys.ArrowRight || bulletKeys.KeyD) heart.x += spd;
    if (bulletKeys.ArrowUp || bulletKeys.KeyW) heart.y -= spd;
    if (bulletKeys.ArrowDown || bulletKeys.KeyS) heart.y += spd;
    heart.x = Math.max(sx(8), Math.min(gw() - sx(8), heart.x));
    heart.y = Math.max(sy(8), Math.min(gh() - sy(8), heart.y));
    if (now >= bulletSpawnAt) {
      spawnBullet();
      bulletSpawnAt = now + 280 + Math.random() * 220;
    }
    for (const b of bullets) {
      b.x += b.vx;
      b.y += b.vy;
    }
    const margin = su(20);
    bullets = bullets.filter((b) => b.x > -margin && b.x < gw() + margin && b.y > -margin && b.y < gh() + margin);
    for (const b of bullets) {
      if (Math.hypot(b.x - heart.x, b.y - heart.y) < b.r + su(6)) {
        b.x = -999;
        score = Math.max(0, score - 2);
      }
    }
    score += 0.02;
  }

  function updateFlappy(now) {
    if (flappyDead) return;
    flappyBird.vy += flappyBird.grav;
    flappyBird.y += flappyBird.vy;
    if (flappyBird.y < sy(8) || flappyBird.y > gh() - sy(8)) {
      flappyDead = true;
      return;
    }
    if (now >= flappySpawnAt) {
      spawnFlappyPipe();
      flappySpawnAt = now + 1400 + Math.random() * 600;
    }
    const bx = sx(52);
    const br = su(8);
    const pipeW = sx(28);
    const pipeSpeed = su(2.4);
    for (const p of flappyPipes) p.x -= pipeSpeed;
    flappyPipes = flappyPipes.filter((p) => p.x > -su(50));
    for (const p of flappyPipes) {
      const gapTop = p.topH;
      const gapBot = p.topH + p.gap;
      if (bx + br > p.x && bx - br < p.x + pipeW) {
        if (flappyBird.y - br < gapTop || flappyBird.y + br > gapBot) {
          flappyDead = true;
          return;
        }
      }
      if (!p.scored && p.x + pipeW < bx) {
        p.scored = true;
        score += 1;
      }
    }
  }

  function updateBreakout() {
    const paddleW = sx(44);
    const paddleH = sy(8);
    const spd = su(3.6);
    if (breakoutKeys.ArrowLeft || breakoutKeys.KeyA) breakoutPaddle -= spd;
    if (breakoutKeys.ArrowRight || breakoutKeys.KeyD) breakoutPaddle += spd;
    breakoutPaddle = Math.max(sx(4), Math.min(gw() - paddleW - sx(4), breakoutPaddle));
    const b = breakoutBall;
    b.x += b.vx;
    b.y += b.vy;
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
    if (b.x + b.r > gw()) { b.x = gw() - b.r; b.vx = -Math.abs(b.vx); }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }
    const py = gh() - sy(14);
    if (b.y + b.r >= py && b.y - b.r <= py + paddleH
      && b.x >= breakoutPaddle && b.x <= breakoutPaddle + paddleW && b.vy > 0) {
      const hit = (b.x - breakoutPaddle) / paddleW - 0.5;
      b.vy = -Math.abs(b.vy);
      b.vx = hit * su(5.5);
      b.y = py - b.r;
    }
    if (b.y > gh() + sy(10)) {
      b.x = gw() / 2;
      b.y = gh() * 0.72;
      b.vx = su(2.4) * (Math.random() > 0.5 ? 1 : -1);
      b.vy = su(-2.8);
    }
    for (const brick of breakoutBricks) {
      if (!brick.alive) continue;
      if (b.x + b.r > brick.x && b.x - b.r < brick.x + brick.w
        && b.y + b.r > brick.y && b.y - b.r < brick.y + brick.h) {
        brick.alive = false;
        score += 1;
        b.vy *= -1;
        break;
      }
    }
  }

  function drawFrame(now) {
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#12121c';
    ctx.fillRect(0, 0, w, h);

    if (gameId === 'piano') {
      const laneW = w / 4;
      const hitY = h * 0.82;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * laneW, 0);
        ctx.lineTo(i * laneW, h);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, hitY - 2, w, 4);
      if (now >= pianoSpawnAt) {
        spawnPianoNote();
        pianoSpawnAt = now + 380 + Math.random() * 280;
      }
      for (const n of pianoNotes) {
        if (!n.hit) n.y += pianoSpeed;
      }
      pianoNotes = pianoNotes.filter((n) => n.hit ? n.y < h + 40 : n.y < h + 30);
      for (const n of pianoNotes) {
        if (n.hit) continue;
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(n.lane * laneW + sx(4), n.y, laneW - sx(8), sy(22));
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(su(12))}px system-ui,sans-serif`;
      ctx.fillText('D  F  J  K', sx(8), h - sy(10));
    }

    if (gameId === 'rhythm') {
      const cx = w / 2;
      const cy = h / 2;
      if (now >= rhythmNext) {
        rhythmNext = now + 520 + Math.random() * 180;
        rhythmWindow = now;
        rhythmRing = 1;
      }
      if (rhythmWindow) {
        const age = now - rhythmWindow;
        rhythmRing = Math.max(0.12, 1 - age / 520);
        if (age > 520) rhythmWindow = 0;
      }
      ctx.strokeStyle = '#06ffa5';
      ctx.lineWidth = su(3);
      ctx.beginPath();
      ctx.arc(cx, cy, su(40) + (1 - rhythmRing) * su(90), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#06ffa5';
      ctx.beginPath();
      ctx.arc(cx, cy, su(28), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `${Math.round(su(13))}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('ESPACIO', cx, cy + 4);
      ctx.textAlign = 'left';
    }

    if (gameId === 'bullet') {
      updateBullet(now);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.fillStyle = '#ff006e';
      for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ff0000';
      const hs = su(5);
      ctx.fillRect(heart.x - hs, heart.y - hs, hs * 2, hs * 2);
      ctx.fillStyle = '#111';
      ctx.font = `${Math.round(su(11))}px system-ui,sans-serif`;
      ctx.fillText('Flechas · sobrevive', sx(8), h - sy(10));
    }

    if (gameId === 'flappy') {
      updateFlappy(now);
      ctx.fillStyle = '#70d6ff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#38b000';
      const pipeW = sx(28);
      for (const p of flappyPipes) {
        ctx.fillRect(p.x, 0, pipeW, p.topH);
        ctx.fillRect(p.x, p.topH + p.gap, pipeW, h - p.topH - p.gap);
      }
      ctx.fillStyle = flappyDead ? '#888' : '#ffbe0b';
      ctx.beginPath();
      ctx.arc(sx(52), flappyBird.y, su(8), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `${Math.round(su(11))}px system-ui,sans-serif`;
      ctx.fillText(flappyDead ? 'ESPACIO · reintentar' : 'ESPACIO · volar', sx(8), h - sy(10));
    }

    if (gameId === 'snake') {
      const cell = Math.min(w, h) / SNAKE_CELLS;
      const offX = (w - cell * SNAKE_CELLS) / 2;
      const offY = (h - cell * SNAKE_CELLS) / 2;
      if (now >= snakeTickAt) {
        tickSnake();
        snakeTickAt = now + (snakeAlive ? 130 : 400);
      }
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let i = 1; i < SNAKE_CELLS; i++) {
        ctx.beginPath();
        ctx.moveTo(offX + i * cell, offY);
        ctx.lineTo(offX + i * cell, offY + cell * SNAKE_CELLS);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(offX, offY + i * cell);
        ctx.lineTo(offX + cell * SNAKE_CELLS, offY + i * cell);
        ctx.stroke();
      }
      ctx.fillStyle = '#ff006e';
      ctx.fillRect(
        offX + snakeFood.x * cell + su(2),
        offY + snakeFood.y * cell + su(2),
        cell - su(4),
        cell - su(4),
      );
      for (let i = 0; i < snakeBody.length; i++) {
        ctx.fillStyle = i === 0 ? '#70e000' : '#55a630';
        const s = snakeBody[i];
        ctx.fillRect(
          offX + s.x * cell + su(1),
          offY + s.y * cell + su(1),
          cell - su(2),
          cell - su(2),
        );
      }
      if (!snakeAlive) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = '13px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('¡Choque!', w / 2, h / 2);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(su(11))}px system-ui,sans-serif`;
      ctx.fillText('Flechas · come', sx(8), h - sy(10));
    }

    if (gameId === 'breakout') {
      updateBreakout();
      ctx.fillStyle = '#1b263b';
      ctx.fillRect(0, 0, w, h);
      const colors = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d'];
      const paddleW = sx(44);
      const paddleH = sy(8);
      const py = gh() - sy(14);
      for (const brick of breakoutBricks) {
        if (!brick.alive) continue;
        const row = Math.floor((brick.y - sy(6)) / sy(12));
        ctx.fillStyle = colors[row % colors.length];
        ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      }
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(breakoutPaddle, py, paddleW, paddleH);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(breakoutBall.x, breakoutBall.y, breakoutBall.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(su(11))}px system-ui,sans-serif`;
      ctx.fillText('← → · pala', sx(8), h - sy(10));
    }

    const left = Math.ceil((endAt - Date.now()) / 1000);
    setHud(session?.gameName || gameId, Math.floor(score), left);
    if (Date.now() >= endAt) {
      finish();
      return;
    }
    raf = requestAnimationFrame(drawFrame);
  }

  async function finish() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    raf = null;
    clearInterval(liveTimer);
    liveTimer = null;
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    $('arcade-game-overlay').hidden = true;
    const sid = session?.sessionId;
    const gid = gameId;
    session = null;
    gameId = null;
    if (!sid || !gid) return;
    try {
      const scoreGames = new Set(['bullet', 'flappy', 'snake', 'breakout']);
      const body = scoreGames.has(gid)
        ? { sessionId: sid, score: Math.floor(score) }
        : { sessionId: sid, hits: Math.floor(score) };
      const res = await fetch(`/api/minigame/${gid}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al validar');
      deps?.toast?.(`¡${gid}! +${fmtCoins(data.coins)}🪙 (${data.score ?? data.hits} pts)`);
      if (data.user) deps?.onUserUpdate?.(data.user);
      else deps?.onWallet?.({ coins: data.totalCoins });
    } catch (err) {
      deps?.toast?.(err.message, true);
    }
  }

  async function cancel() {
    if (!isOpen() && !running) return false;
    running = false;
    cancelAnimationFrame(raf);
    raf = null;
    clearInterval(liveTimer);
    liveTimer = null;
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    $('arcade-game-overlay').hidden = true;
    const sid = session?.sessionId;
    const gid = gameId;
    session = null;
    gameId = null;
    if (sid && gid) {
      try {
        await fetch(`/api/minigame/${gid}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionId: sid }),
        });
      } catch (_) {}
    }
    return true;
  }

  async function open(id, gameMeta, meta) {
    if (!deps?.getUser?.()) {
      deps?.toast?.('Inicia sesión para jugar', true);
      return;
    }
    if (running) await cancel();
    try {
      const res = await fetch(`/api/minigame/${id}/start`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar');
      gameId = id;
      zoneMeta = meta || null;
      session = {
        sessionId: data.sessionId,
        durationMs: data.durationMs,
        gameName: gameMeta?.name || id,
      };
      deps?.closeModals?.();
      const overlayEl = $('arcade-game-overlay');
      canvas = $('arcade-game-canvas');
      if (!overlayEl || !canvas) return;
      fitCanvas();
      resetState(id);
      overlayEl.hidden = false;
      ctx = canvas.getContext('2d', { alpha: false });
      running = true;
      endAt = Date.now() + (data.durationMs || 25000);
      setHud(session.gameName, 0, Math.ceil((data.durationMs || 25000) / 1000));
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);
      pingLive();
      liveTimer = setInterval(pingLive, 900);
      raf = requestAnimationFrame(drawFrame);
    } catch (err) {
      deps?.toast?.(err.message, true);
    }
  }

  function tryLaunchAt(x, y, games, zones) {
    if (running || isOpen()) return false;
    const zone = (zones || []).find((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
    if (!zone?.game) return false;
    const game = (games || []).find((g) => g.id === zone.game);
    if (!game) return false;
    open(zone.game, game, { zone });
    return true;
  }

  function bindUI() {
    $('arcade-game-cancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      cancel();
    });
    $('arcade-game-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'arcade-game-overlay') cancel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && isOpen()) {
        e.stopImmediatePropagation();
        cancel();
      }
    }, true);
  }

  function init(options) {
    deps = options;
    bindUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }

  window.ArcadeGames = {
    init,
    open,
    cancel,
    isOpen,
    tryLaunchAt,
  };
})();
