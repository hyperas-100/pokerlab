/* PokerLab UI */
(function () {
  'use strict';
  const PK = globalThis.PK, E = PK.Engine, B = PK.Bots, Rv = PK.Review, R = PK.Range;
  const BB = 20; // chips per big blind
  const app = document.getElementById('app');
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const bbs = (chips, d) => { const v = chips / BB; const s = (d === undefined ? (Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1) : d); return v.toFixed(s) + ' bb'; };
  const num = (chips) => (chips / BB).toFixed(Math.abs(chips / BB - Math.round(chips / BB)) < 0.05 ? 0 : 1);
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

  const NAMES = ['Alex', 'Maya', 'Rico', 'Dana', 'Gus', 'Lena', 'Omar', 'Priya', 'Sven', 'Tess', 'Kai', 'Nina', 'Vic', 'Zoe', 'Hugo', 'Ines', 'Jude', 'Mara', 'Ned', 'Opal', 'Pete', 'Quin', 'Rae', 'Sol', 'Tom', 'Uma', 'Walt', 'Yara'];
  const SUIT = ['♣', '♦', '♥', '♠'];
  const STYLES = B.STYLES, BY = B.BY_ID, STATS = PK.StyleStats || {};
  const PRESETS = [
    { name: 'Mixed table', ids: null },
    { name: 'Soft game', ids: ['fish', 'station', 'limper', 'whale', 'hero', 'scared', 'tourist', 'draw'] },
    { name: 'Tough regs', ids: ['tag', 'lag', 'gto', 'shark', 'threebetter', 'checkraiser', 'cbetter', 'polarizer'] },
    { name: 'Maniac madness', ids: ['maniac', 'bluffer', 'whale', 'lag', 'polarizer', 'maniac', 'steamer', 'threebetter'] },
    { name: 'Nit city', ids: ['nit', 'oldman', 'scared', 'overfolder', 'cbetter', 'tag', 'trapper', 'nit'] },
    { name: 'Sharks & fish', ids: ['shark', 'fish', 'station', 'gto', 'whale', 'tag', 'limper', 'lag'] },
  ];

  /* ---------- persisted config ---------- */
  const cfg = Object.assign({ n: 6, heroPos: 'random', stack: 100, carry: true, rotate: true, seats: [] }, store.get('pl_cfg_v1', {}));
  const settings = Object.assign({ reveal: false, hud: true, fast: false, odds: true, gradeMode: 'bot', tab: 'quick' }, store.get('pl_set_v1', {}));
  const saveCfg = () => store.set('pl_cfg_v1', cfg), saveSet = () => store.set('pl_set_v1', settings);
  const randStyle = () => STYLES[Math.floor(Math.random() * STYLES.length)].id;
  function ensureSeats() {
    cfg.seats = (cfg.seats || []).filter((id) => BY[id]);
    while (cfg.seats.length < cfg.n - 1) cfg.seats.push(randStyle());
    cfg.seats.length = cfg.n - 1;
  }
  const posList = (n) => (n === 2 ? ['BTN', 'BB'] : ['BTN', 'SB', 'BB'].concat(E.POS_NAMES[n - 3] || []));
  function posOffset(n, p) {
    if (n === 2) return p === 'BTN' ? 0 : 1;
    if (p === 'BTN') return 0; if (p === 'SB') return 1; if (p === 'BB') return 2;
    return 3 + (E.POS_NAMES[n - 3] || []).indexOf(p);
  }
  const pill = (t) => `<span class="pill">${esc(t)}</span>`;
  function statPills(id) { const s = STATS[id]; return s ? pill('VPIP ' + s.vpip + '%') + pill('PFR ' + s.pfr + '%') + pill('Aggression ' + s.af) + pill('Folds to bets ' + s.foldToBet + '%') : ''; }

  /* ---------- cards ---------- */
  function cardEl(c, cls) {
    if (c === null) return `<span class="card back ${cls || ''}"></span>`;
    const r = E.RANKS[c >> 2], s = c & 3;
    return `<span class="card ${s === 1 || s === 2 ? 'red' : ''} ${cls || ''}"><b>${r === 'T' ? '10' : r}</b><i>${SUIT[s]}</i></span>`;
  }

  /* ---------- state ---------- */
  let g = null, bot = null, heroId = 0, hud = {}, session = null, token = 0, rv = { open: false, rec: null }, raiseOpen = false, raiseVal = 0, lastRec = null;
  const view = { screen: 'setup' };

  /* ================= SETUP ================= */
  function renderSetup() {
    view.screen = 'setup'; token++; ensureSeats();
    const posOpts = ['random'].concat(posList(cfg.n));
    if (!posOpts.includes(cfg.heroPos)) cfg.heroPos = 'random';
    app.innerHTML = `<div class="setup">
      <div class="brand"><h1>Poker<span>Lab</span></h1><p>Practice No-Limit Hold'em against bots with 25 different playstyles. After every hand you get a review of each of your decisions.</p></div>
      <div class="card-box"><h2>Table</h2>
        <div class="row">
          <div class="field"><label>Players at the table</label><div class="stepper"><button id="nMinus" aria-label="Fewer players">−</button><b id="nVal">${cfg.n}</b><button id="nPlus" aria-label="More players">+</button></div></div>
          <div class="field"><label for="heroPos">Your starting position</label><select id="heroPos">${posOpts.map((p) => `<option value="${p}" ${p === cfg.heroPos ? 'selected' : ''}>${p === 'random' ? 'Random' : p}</option>`).join('')}</select></div>
          <div class="field"><label for="stack">Starting stacks</label><select id="stack">${[20, 40, 60, 100, 150, 200].map((s) => `<option value="${s}" ${s === cfg.stack ? 'selected' : ''}>${s} big blinds</option>`).join('')}</select></div>
        </div>
        <div class="row" style="margin-top:12px">
          <label class="toggle"><input type="checkbox" id="rotate" ${cfg.rotate ? 'checked' : ''}><span>Rotate positions every hand<small>Turn off to drill one position over and over</small></span></label>
          <label class="toggle"><input type="checkbox" id="carry" ${cfg.carry ? 'checked' : ''}><span>Keep stacks between hands<small>Off: everyone resets to the starting stack</small></span></label>
        </div>
      </div>
      <div class="card-box"><h2>Opponents</h2>
        <div class="presets">${PRESETS.map((p, i) => `<button class="btn sm" data-preset="${i}">${esc(p.name)}</button>`).join('')}<button class="btn sm" id="guideBtn">Bot guide</button></div>
        <div class="seatlist" style="margin-top:12px" id="seatlist">${seatRows()}</div>
      </div>
      <div class="card-box"><h2>While you play</h2>
        <div class="row">
          <label class="toggle"><input type="checkbox" data-set="reveal" ${settings.reveal ? 'checked' : ''}><span>Show opponent playstyles<small>Off: read them from how they play</small></span></label>
          <label class="toggle"><input type="checkbox" data-set="hud" ${settings.hud ? 'checked' : ''}><span>Show live stats (VPIP / PFR)<small>Tracked over the session, like a poker HUD</small></span></label>
          <label class="toggle"><input type="checkbox" data-set="odds" ${settings.odds ? 'checked' : ''}><span>Show pot odds<small>Price of a call and the equity it needs</small></span></label>
          <label class="toggle"><input type="checkbox" data-set="fast" ${settings.fast ? 'checked' : ''}><span>Fast bots<small>Shorter pauses between actions</small></span></label>
        </div>
      </div>
      <div class="startbar"><button class="btn pri big" id="startBtn">Deal me in</button></div>
    </div>`;
    wireSetup();
    window.scrollTo(0, 0);
  }
  function seatRows() {
    let h = '';
    for (let i = 0; i < cfg.n - 1; i++) {
      const id = cfg.seats[i], st = BY[id];
      h += `<div class="seatrow"><div class="lbl">Seat ${i + 2}<small>${i === 0 ? 'left of you' : ''}</small></div><div>
        <select data-seat="${i}" aria-label="Playstyle for seat ${i + 2}">${STYLES.map((s) => `<option value="${s.id}" ${s.id === id ? 'selected' : ''}>${esc(s.name)} — ${esc(s.tags)}</option>`).join('')}</select>
        <div class="desc">${esc(st.desc)}</div><div class="stats">${statPills(id)}</div></div></div>`;
    }
    return h;
  }
  function wireSetup() {
    $('#nMinus').onclick = () => { if (cfg.n > 2) { cfg.n--; saveCfg(); renderSetup(); } };
    $('#nPlus').onclick = () => { if (cfg.n < 9) { cfg.n++; saveCfg(); renderSetup(); } };
    $('#heroPos').onchange = (e) => { cfg.heroPos = e.target.value; saveCfg(); };
    $('#stack').onchange = (e) => { cfg.stack = +e.target.value; saveCfg(); };
    $('#rotate').onchange = (e) => { cfg.rotate = e.target.checked; saveCfg(); };
    $('#carry').onchange = (e) => { cfg.carry = e.target.checked; saveCfg(); };
    $$('[data-seat]').forEach((s) => (s.onchange = () => { cfg.seats[+s.dataset.seat] = s.value; saveCfg(); $('#seatlist').innerHTML = seatRows(); wireSeats(); }));
    $$('[data-preset]').forEach((b) => (b.onclick = () => {
      const p = PRESETS[+b.dataset.preset];
      cfg.seats = Array.from({ length: cfg.n - 1 }, (_, i) => (p.ids ? p.ids[i % p.ids.length] : randStyle()));
      if (p.ids) cfg.seats.sort(() => Math.random() - 0.5);
      saveCfg(); $('#seatlist').innerHTML = seatRows(); wireSeats(); toast('Table set: ' + p.name);
    }));
    $$('[data-set]').forEach((c) => (c.onchange = () => { settings[c.dataset.set] = c.checked; saveSet(); }));
    $('#guideBtn').onclick = openGuide;
    $('#startBtn').onclick = startSession;
  }
  function wireSeats() { $$('[data-seat]').forEach((s) => (s.onchange = () => { cfg.seats[+s.dataset.seat] = s.value; saveCfg(); $('#seatlist').innerHTML = seatRows(); wireSeats(); })); }

  /* ================= SESSION ================= */
  function startSession() {
    ensureSeats();
    const names = NAMES.slice().sort(() => Math.random() - 0.5);
    const seats = [{ name: 'You', human: true }].concat(cfg.seats.map((id, i) => ({ name: names[i], style: id })));
    g = new E.Game({ seats, sb: BB / 2, bb: BB, startStack: cfg.stack * BB, stackMode: cfg.carry ? 'carry' : 'reset', rotate: cfg.rotate, rnd: Math.random });
    heroId = 0; bot = B.createState(); hud = {}; session = { hands: [], startedAt: Date.now() }; rv = { open: false, rec: null }; lastRec = null;
    const list = posList(cfg.n), target = cfg.heroPos === 'random' ? list[Math.floor(Math.random() * list.length)] : cfg.heroPos;
    const b = (heroId - posOffset(cfg.n, target) + cfg.n * 2) % cfg.n;
    g.button = cfg.rotate ? (b - 1 + cfg.n) % cfg.n : b;
    view.screen = 'game';
    nextHand();
  }
  function nextHand() {
    closeReview(true); lastRec = null; raiseOpen = false;
    const wasBust = g.players[heroId].stack <= 0 && g.stackMode === 'carry';
    g.startHand();
    if (wasBust) toast('You were out of chips, so you rebought for ' + cfg.stack + ' bb');
    runLoop();
  }
  async function runLoop() {
    const my = ++token;
    while (g.phase === 'betting' && g.toAct !== heroId) {
      renderGame();
      const hf = g.players[heroId].folded;
      await sleep(hf ? 110 : settings.fast ? 230 : 720);
      if (my !== token) return;
      const before = g.street, pid = g.toAct;
      g.act(pid, B.decide(g, pid, bot, Math.random));
      if (g.phase === 'betting' && g.street !== before && !hf) { renderGame(); await sleep(settings.fast ? 200 : 520); if (my !== token) return; }
    }
    renderGame();
    if (g.phase === 'over') onHandOver();
  }
  function onHandOver() {
    if (lastRec && lastRec.no === g.handNo) return;
    // HUD
    for (const p of g.players) {
      const h = hud[p.id] || (hud[p.id] = { h: 0, v: 0, r: 0 });
      h.h++;
      const pre = g.actions.filter((a) => a.pid === p.id && a.street === 'preflop');
      if (pre.some((a) => a.type === 'call' || a.type === 'raise')) h.v++;
      if (pre.some((a) => a.type === 'raise')) h.r++;
    }
    B.afterHand(g, bot);
    let review;
    try { review = Rv.analyzeHand(g, heroId, {}); } catch (e) { console.error(e); review = { decisions: [], netBB: g.players[heroId].net / BB }; }
    const rec = { no: g.handNo, net: g.players[heroId].net, hole: g.players[heroId].hole.slice(), board: g.board.slice(), pos: g.players[heroId].pos, review, result: g.result, names: g.players.map((p) => p.name) };
    session.hands.push(rec); lastRec = rec;
    renderGame();
  }

  /* ================= GAME RENDER ================= */
  function lastAction(pid) {
    for (let i = g.log.length - 1; i >= 0; i--) {
      const l = g.log[i];
      if (l.t === 'deal' && l.street === g.street) break;
      if (l.pid !== pid || l.t === 'post' || l.t === 'deal' || l.t === 'result') continue;
      if (l.street !== g.street && l.t !== 'fold') return null;
      return l;
    }
    return null;
  }
  function seatXY(p, n) {
    const slot = (p.id - heroId + n) % n, th = Math.PI / 2 + slot * 2 * Math.PI / n;
    const narrow = window.innerWidth < 700; return { x: 50 + (narrow ? 38 : 44) * Math.cos(th), y: 50 + (narrow ? 39 : 40) * Math.sin(th) };
  }
  function actLabel(l) {
    if (!l) return ['', ''];
    if (l.t === 'fold') return ['Fold', 'fold'];
    if (l.t === 'check') return ['Check', ''];
    if (l.t === 'call') return ['Call', 'call'];
    return [(l.bet ? 'Bet ' : 'Raise ') + num(l.to) + (l.allIn ? ' (all-in)' : ''), 'raise'];
  }
  function seatHtml(p) {
    const n = g.n, pos = seatXY(p, n), me = p.id === heroId, over = g.phase === 'over';
    const reveal = over && g.result && !g.result.uncontested && !p.folded;
    const winner = over && g.result && g.result.nets[p.id] > 0;
    const [al, ac] = actLabel(lastAction(p.id));
    let cards = '';
    if (!me && !p.folded) cards = reveal ? p.hole.map((c) => cardEl(c, 'sm' + (winner ? ' win' : ''))).join('') : cardEl(null, 'sm') + cardEl(null, 'sm');
    const st = BY[p.style];
    let meta = '';
    if (!me) {
      if (settings.reveal && st) meta = st.name;
      else if (settings.hud) { const h = hud[p.id]; meta = h && h.h >= 6 ? `V${Math.round(h.v / h.h * 100)} P${Math.round(h.r / h.h * 100)} · ${h.h}h` : 'new'; }
    }
    const stackTxt = p.stack === 0 && p.total > 0 && !p.folded ? 'All-in' : bbs(p.stack);
    return `<div class="seat ${me ? 'me' : ''} ${p.folded ? 'folded' : ''} ${g.toAct === p.id && g.phase === 'betting' ? 'turn' : ''} ${winner ? 'winner' : ''}" style="left:${pos.x}%;top:${pos.y}%">
      ${me ? '' : `<div class="cards">${cards}</div>`}
      <div class="plate"><span class="pos">${p.pos}</span><div class="nm">${esc(p.name)}</div><div class="st">${stackTxt}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div>
      <div class="act ${ac}">${esc(al)}</div></div>`;
  }
  function overlays() {
    let h = '';
    for (const p of g.players) {
      const pos = seatXY(p, g.n);
      if (p.bet > 0 && !p.folded) h += `<div class="betchip" style="left:${50 + (pos.x - 50) * 0.56}%;top:${50 + (pos.y - 50) * 0.56}%">${num(p.bet)}</div>`;
      if (p.id === g.button) h += `<div class="dbtn" style="left:${50 + (pos.x - 50) * 0.8 + (pos.x < 50 ? 7 : -7)}%;top:${50 + (pos.y - 50) * 0.8}%">D</div>`;
    }
    return h;
  }
  function madeText(p) {
    if (!p.hole.length) return '';
    if (g.board.length < 3) { const k = R.keyOf(p.hole[0], p.hole[1]); return `<b>${k}</b>top ${Math.max(1, Math.round(R.pct(p.hole) * 100))}% hand`; }
    return `<b>${E.handName(E.eval7(p.hole.concat(g.board)))}</b>your hand`;
  }
  function renderGame() {
    if (view.screen !== 'game' || !g) return;
    const me = g.players[heroId], over = g.phase === 'over';
    const board = Array.from({ length: 5 }, (_, i) => (g.board[i] !== undefined ? cardEl(g.board[i], over && g.result && g.result.nets[heroId] > 0 && !g.result.uncontested ? '' : '') : '<span class="card empty"></span>')).join('');
    let below = '';
    const heroTurn = g.phase === 'betting' && g.toAct === heroId;
    if (heroTurn) below = heroActions();
    else if (over) below = overPanel();
    else below = `<div class="info">${g.players[g.toAct] ? esc(g.players[g.toAct].name) + ' is thinking…' : ''}</div>`;
    const prevRaise = $('#rvOpen');
    app.innerHTML = `<div class="game">
      <div class="topbar"><button class="btn sm" id="backBtn">← Setup</button><div class="t">Hand ${g.handNo}<small>${cfg.n} players · ${num(g.sb)}/${num(g.bb)} bb</small></div>
        <button class="btn sm" id="optBtn">Options</button><button class="btn sm" id="statBtn">Session</button></div>
      <div class="felt-wrap"><div class="felt"></div>
        <div class="pot">Pot ${bbs(g.pot())}</div><div class="board">${board}</div>
        ${g.players.map(seatHtml).join('')}${overlays()}</div>
      <div class="below">
        <div class="herohand">${me.hole.map((c) => cardEl(c)).join('')}<div class="made">${madeText(me)}</div></div>
        ${below}
      </div></div>${rv.open ? reviewHtml() : ''}`;
    wireGame();
  }
  function heroActions() {
    const L = g.legal(heroId), p = g.players[heroId], pot = g.pot();
    const call = L.toCall, facing = call > 0;
    let info = '';
    if (settings.odds) {
      if (facing) info = `Pot <b>${bbs(pot)}</b> · To call <b>${bbs(call)}</b> · You need about <b>${Math.round(call / (pot + call) * 100)}%</b> equity`;
      else info = `Pot <b>${bbs(pot)}</b> · No bet to you`;
    } else info = facing ? `To call <b>${bbs(call)}</b>` : 'Your action';
    const btns = [];
    if (facing) btns.push(`<button class="btn red" id="foldBtn">Fold</button>`);
    btns.push(`<button class="btn green" id="callBtn">${facing ? (call >= p.stack ? 'Call all-in ' : 'Call ') + bbs(call) : 'Check'}</button>`);
    if (L.canRaise) btns.push(`<button class="btn pri" id="raiseBtn">${g.currentBet === 0 ? 'Bet' : 'Raise'}…</button>`);
    return `<div class="info">${info}</div><div class="actions">${btns.join('')}</div>${raiseOpen && L.canRaise ? raisePanel(L) : ''}`;
  }
  function raiseOptions(L) {
    const pot = g.pot(), out = [], add = (label, to) => { to = Math.round(clamp(to, L.minRaiseTo, L.maxRaiseTo)); if (!out.some((o) => o.to === to)) out.push({ label, to }); };
    if (g.street === 'preflop') {
      if (g.preflopRaises === 0) { const lim = g.limpers; add('2.5x', BB * (2.5 + lim)); add('3x', BB * (3 + lim)); add('4x', BB * (4 + lim)); }
      else { add('2.5x', g.currentBet * 2.5); add('3x', g.currentBet * 3); add('4x', g.currentBet * 4); }
    } else if (g.currentBet === 0) { add('⅓ pot', pot / 3); add('½ pot', pot / 2); add('⅔ pot', pot * 2 / 3); add('Pot', pot); }
    else { add('2.5x', g.currentBet * 2.5); add('3x', g.currentBet * 3); add('Pot', g.currentBet + pot + L.toCall); }
    add('All-in', L.maxRaiseTo);
    return out;
  }
  function raisePanel(L) {
    if (raiseVal < L.minRaiseTo || raiseVal > L.maxRaiseTo) raiseVal = L.minRaiseTo;
    const opts = raiseOptions(L);
    return `<div class="raisepanel">
      <div class="qs"><button class="btn" data-to="${L.minRaiseTo}">Min</button>${opts.map((o) => `<button class="btn" data-to="${o.to}">${o.label}</button>`).join('')}</div>
      <div class="sl"><button class="btn sm" id="rMinus">−</button><input type="range" id="rRange" min="${L.minRaiseTo}" max="${L.maxRaiseTo}" step="1" value="${raiseVal}" aria-label="Raise amount"><button class="btn sm" id="rPlus">+</button><div class="val" id="rVal">${bbs(raiseVal)}</div></div>
      <button class="btn pri big" id="rGo">${raiseVal >= L.maxRaiseTo ? 'All-in ' : (g.currentBet === 0 ? 'Bet ' : 'Raise to ')}${bbs(raiseVal)}</button></div>`;
  }
  function overPanel() {
    const r = g.result, me = g.players[heroId];
    const winners = g.players.filter((p) => r.nets[p.id] > 0);
    let head;
    const net = me.net;
    if (net > 0) head = `You won ${bbs(net)}`; else if (net < 0) head = `You lost ${bbs(-net)}`; else head = 'You broke even';
    const lines = winners.map((w) => `${esc(w.name)} wins ${bbs(r.nets[w.id] + w.total)}${r.uncontested ? ' (everyone folded)' : ' with ' + esc(r.hands[w.id] ? r.hands[w.id].name : '')}`).join('<br>');
    const decs = lastRec ? lastRec.review.decisions : [];
    const chips = {}; decs.forEach((d) => { const x = gradeFor(d); if (x) chips[x] = (chips[x] || 0) + 1; });
    const chipHtml = Object.keys(chips).map((k) => `<span class="gchip g-${k}">${chips[k]} ${k}</span>`).join('');
    return `<div class="over"><div class="res">${head}<small>${lines}</small></div>
      ${decs.length ? `<div class="gradechips">${chipHtml}</div>` : '<div class="mute" style="font-size:.85rem">No real decisions this hand.</div>'}
      <div class="btns"><button class="btn" id="rvOpen">Review hand</button><button class="btn pri" id="nextBtn">Next hand</button></div></div>`;
  }
  function wireGame() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('#backBtn', () => { if (confirm('Leave this table? Your session stats will be lost.')) { token++; renderSetup(); } });
    on('#statBtn', openSession); on('#optBtn', openOptions);
    on('#foldBtn', () => heroAct({ type: 'fold' }));
    on('#callBtn', () => heroAct(g.legal(heroId).toCall > 0 ? { type: 'call' } : { type: 'check' }));
    on('#raiseBtn', () => { raiseOpen = !raiseOpen; raiseVal = 0; renderGame(); });
    on('#rGo', () => heroAct({ type: 'raise', to: raiseVal }));
    on('#nextBtn', nextHand); on('#rvOpen', () => { rv.open = true; rv.rec = lastRec; renderGame(); });
    const range = $('#rRange');
    if (range) {
      const L = g.legal(heroId);
      const setVal = (v) => { raiseVal = clamp(Math.round(v), L.minRaiseTo, L.maxRaiseTo); range.value = raiseVal; $('#rVal').textContent = bbs(raiseVal); $('#rGo').textContent = (raiseVal >= L.maxRaiseTo ? 'All-in ' : (g.currentBet === 0 ? 'Bet ' : 'Raise to ')) + bbs(raiseVal); };
      range.oninput = () => setVal(+range.value);
      $$('[data-to]').forEach((b) => (b.onclick = () => setVal(+b.dataset.to)));
      on('#rMinus', () => setVal(raiseVal - BB / 2)); on('#rPlus', () => setVal(raiseVal + BB / 2));
    }
    wireReview();
  }
  function heroAct(a) {
    if (!(g.phase === 'betting' && g.toAct === heroId)) return;
    try { g.act(heroId, a); } catch (e) { toast(e.message); return; }
    raiseOpen = false; raiseVal = 0; runLoop();
  }
  document.addEventListener('keydown', (e) => {
    if (view.screen !== 'game' || !g || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || rv.open) return;
    if (g.phase === 'over' && (e.key === 'n' || e.key === 'Enter')) return nextHand();
    if (!(g.phase === 'betting' && g.toAct === heroId)) return;
    const L = g.legal(heroId);
    if (e.key === 'f' && L.toCall > 0) heroAct({ type: 'fold' });
    else if (e.key === 'c') heroAct(L.toCall > 0 ? { type: 'call' } : { type: 'check' });
    else if (e.key === 'r' && L.canRaise) { raiseOpen = !raiseOpen; raiseVal = 0; renderGame(); }
    else if (e.key === 'Enter' && raiseOpen) heroAct({ type: 'raise', to: raiseVal });
  });

  /* ================= REVIEW ================= */
  function gradeFor(d) {
    if (settings.tab === 'quick') return d.quick.grade === 'Good' ? 'Good' : d.quick.grade;
    const m = d.deep[settings.gradeMode] || d.deep.std || d.deep.bot; return m ? m.grade : null;
  }
  function actionText(d) {
    const bb = d.bb;
    if (d.type === 'fold') return 'Fold';
    if (d.type === 'check') return 'Check';
    if (d.type === 'call') return 'Call ' + bbs(d.toCall) + (d.allIn ? ' (all-in)' : '');
    return (d.toCall === 0 && d.street !== 'preflop' ? 'Bet ' : 'Raise to ') + bbs(d.to) + (d.allIn ? ' (all-in)' : '');
  }
  function cardsLine(d) {
    return `<div class="cardsline">${d.hole.map((c) => cardEl(c)).join('')}${d.board.length ? '<span class="sep"></span>' + d.board.map((c) => cardEl(c)).join('') : ''}</div>`;
  }
  function decisionHtml(d) {
    const deepM = d.deep[settings.gradeMode] || d.deep.std || d.deep.bot;
    const grade = gradeFor(d);
    let body = '';
    if (settings.tab === 'quick') {
      body = `<div class="you">Rule-of-thumb play: <b>${esc(d.quick.recLabel)}</b></div><ul class="lines">${d.quick.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="tipbox">Quick tips use standard opening charts and pot odds against a typical opponent. Switch to Deep analysis for an EV breakdown.</div>`;
    } else if (deepM) {
      const maxAbs = Math.max(1, ...deepM.opts.map((o) => Math.abs(o.evBB)));
      const rows = deepM.opts.map((o) => {
        const you = o.label.includes('(your play)') || (o.label === deepM.chosen.label && Math.abs(o.ev - deepM.chosen.ev) < 1e-9);
        const w = Math.round(Math.abs(o.evBB) / maxAbs * 100);
        return `<div class="opt ${o.best ? 'best' : ''} ${you ? 'you' : ''}"><div class="bar ${o.evBB < 0 ? 'neg' : ''}" style="width:${w}%"></div><span>${esc(o.label.replace(' (your play)', ''))}${o.best ? '<em class="tagb b">BEST</em>' : ''}${you ? '<em class="tagb">YOU</em>' : ''}</span><span class="ev">${o.evBB >= 0 ? '+' : ''}${o.evBB.toFixed(1)} bb</span></div>`;
      }).join('');
      const vil = (settings.gradeMode === 'bot' ? d.villains : d.villainsStd).map((v) => pill(`${v.name}: ${v.styleName} (${v.pos}) ~${v.rangePct}% range`)).join('');
      const tip = d.villains.find((v) => v.tip);
      body = `<div class="you">${deepM.lossBB < 0.05 ? 'Nothing left on the table.' : `Estimated cost of your play: <b>${deepM.lossBB.toFixed(1)} bb</b> versus the best option.`}${deepM.close && deepM.lossBB >= 0.05 ? ' <span class="mute">(a close call)</span>' : ''}</div>
        <ul class="lines">${deepM.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="opts">${rows}</div><div class="vil">${vil}</div>
        ${tip ? `<div class="tipbox"><b>Versus ${esc(tip.styleName)}:</b> ${esc(tip.tip)}</div>` : ''}`;
    }
    return `<div class="dec"><div class="dec-top"><span class="st">${esc(d.street)}</span>${pill(d.pos + (d.ip ? ' · in position' : ' · out of position'))}<span class="gr gchip g-${grade}">${grade}</span></div>
      ${cardsLine(d)}<div class="you">You: <b>${esc(actionText(d))}</b> <span class="mute">(pot ${bbs(d.pot)}${d.toCall ? ', to call ' + bbs(d.toCall) : ''})</span></div>${body}</div>`;
  }
  function reviewHtml() {
    const rec = rv.rec; if (!rec) return '';
    const r = rec.review, decs = r.decisions;
    const net = rec.net >= 0 ? `<span class="up">+${bbs(rec.net)}</span>` : `<span class="dn">${bbs(rec.net)}</span>`;
    const cnt = {}; decs.forEach((d) => { const x = gradeFor(d); cnt[x] = (cnt[x] || 0) + 1; });
    return `<div class="review" id="rvWrap"><div class="sheet">
      <div class="rv-head"><h2>Hand ${rec.no} review</h2><button class="x" id="rvClose" aria-label="Close">×</button></div>
      <div class="cardsline" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${rec.hole.map((c) => cardEl(c)).join('')}${rec.board.length ? '<span style="width:10px"></span>' + rec.board.map((c) => cardEl(c)).join('') : ''}<span style="margin-left:8px;font-weight:800">${net}</span></div>
      <div class="seg" id="tabSeg"><button data-tab="quick" class="${settings.tab === 'quick' ? 'on' : ''}">Quick tips</button><button data-tab="deep" class="${settings.tab === 'deep' ? 'on' : ''}">Deep analysis</button></div>
      ${settings.tab === 'deep' ? `<div class="seg" id="modeSeg"><button data-mode="bot" class="${settings.gradeMode === 'bot' ? 'on' : ''}">Grade vs these bots</button><button data-mode="std" class="${settings.gradeMode === 'std' ? 'on' : ''}">Grade vs a typical player</button></div>` : ''}
      <div class="gradechips" style="margin:6px 0">${Object.keys(cnt).map((k) => `<span class="gchip g-${k}">${cnt[k]} ${k}</span>`).join('')}</div>
      ${decs.length ? decs.map(decisionHtml).join('') : '<div class="dec">No real decisions this hand (you had no choice to make).</div>'}
      <div class="note">Equity and EV numbers come from Monte Carlo simulation against opponent ranges estimated from their actions. They are good for comparing your options, but they are estimates, not solver output. Bots fold and call at the frequencies of their playstyle, which is why "vs these bots" can differ from "vs a typical player".</div>
      <div style="margin-top:14px"><button class="btn pri big" style="width:100%" id="rvNext">${g.phase === 'over' && lastRec && rec.no === lastRec.no ? 'Next hand' : 'Close'}</button></div>
    </div></div>`;
  }
  function wireReview() {
    if (!rv.open) return;
    $('#rvClose').onclick = () => closeReview();
    $('#rvWrap').onclick = (e) => { if (e.target.id === 'rvWrap') closeReview(); };
    $('#rvNext').onclick = () => { const isLast = g.phase === 'over' && lastRec && rv.rec && rv.rec.no === lastRec.no; closeReview(); if (isLast) nextHand(); };
    $$('#tabSeg [data-tab]').forEach((b) => (b.onclick = () => { settings.tab = b.dataset.tab; saveSet(); keepScroll(); }));
    $$('#modeSeg [data-mode]').forEach((b) => (b.onclick = () => { settings.gradeMode = b.dataset.mode; saveSet(); keepScroll(); }));
  }
  function keepScroll() { const sh = $('#rvWrap .sheet'), top = sh ? sh.scrollTop : 0; renderCurrent(); const sh2 = $('#rvWrap .sheet'); if (sh2) sh2.scrollTop = top; }
  function renderCurrent() { if (view.screen === 'game') renderGame(); }
  function closeReview(silent) { rv.open = false; if (!silent) renderCurrent(); }

  /* ================= SESSION STATS / GUIDE / OPTIONS ================= */
  function modal(html) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box">${html}<div style="margin-top:14px"><button class="btn pri" style="width:100%" data-close>Close</button></div></div>`;
    m.onclick = (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.remove(); };
    document.body.appendChild(m); return m;
  }
  function sessionStats() {
    const hands = session ? session.hands : [];
    const mode = settings.gradeMode, tab = settings.tab;
    const decs = []; hands.forEach((h) => h.review.decisions.forEach((d) => decs.push({ d, h })));
    const getM = (d) => d.deep[mode] || d.deep.std || d.deep.bot;
    const graded = decs.filter((x) => getM(x.d));
    const counts = {}; graded.forEach((x) => { const k = getM(x.d).grade; counts[k] = (counts[k] || 0) + 1; });
    const total = graded.length, good = (counts.Best || 0) + (counts.Good || 0);
    const loss = graded.reduce((s, x) => s + getM(x.d).lossBB, 0);
    const net = hands.reduce((s, h) => s + h.net, 0) / BB;
    const byStreet = {}, byPos = {};
    graded.forEach((x) => { const m = getM(x.d); const s = byStreet[x.d.street] || (byStreet[x.d.street] = { n: 0, loss: 0 }); s.n++; s.loss += m.lossBB; const p = byPos[x.d.pos] || (byPos[x.d.pos] = { n: 0, loss: 0 }); p.n++; p.loss += m.lossBB; });
    const worst = graded.slice().sort((a, b) => getM(b.d).lossBB - getM(a.d).lossBB).slice(0, 5).filter((x) => getM(x.d).lossBB >= 0.4);
    return { hands, counts, total, good, loss, net, byStreet, byPos, worst, getM };
  }
  function openSession() {
    const S = sessionStats(), n = S.hands.length;
    const row = (name, o) => `<tr><td>${esc(name)}</td><td>${o.n}</td><td>${o.loss.toFixed(1)} bb</td><td>${o.n ? (o.loss / o.n).toFixed(2) : '0'} bb</td></tr>`;
    const order = ['preflop', 'flop', 'turn', 'river'];
    const html = `<h2>Session</h2>
      <div class="kpis">
        <div class="kpi"><b>${n}</b><span>hands played</span></div>
        <div class="kpi"><b class="${S.net >= 0 ? 'up' : 'dn'}">${S.net >= 0 ? '+' : ''}${S.net.toFixed(1)} bb</b><span>result${n ? ' (' + (S.net / n * 100).toFixed(0) + ' bb/100)' : ''}</span></div>
        <div class="kpi"><b>${S.total ? Math.round(S.good / S.total * 100) + '%' : '–'}</b><span>decisions graded Best or Good</span></div>
        <div class="kpi"><b>${S.loss.toFixed(1)} bb</b><span>estimated EV given up${n ? ' (' + (S.loss / n * 100).toFixed(0) + '/100 hands)' : ''}</span></div>
      </div>
      <div class="gradechips">${['Best', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'].filter((k) => S.counts[k]).map((k) => `<span class="gchip g-${k}">${S.counts[k]} ${k}</span>`).join('')}</div>
      ${S.total ? `<h3 style="margin-top:16px;font-size:.95rem">Where you lose EV</h3>
        <table class="tbl"><tr><th>Street</th><th>Decisions</th><th>EV lost</th><th>Per decision</th></tr>${order.filter((k) => S.byStreet[k]).map((k) => row(k, S.byStreet[k])).join('')}</table>
        <table class="tbl"><tr><th>Position</th><th>Decisions</th><th>EV lost</th><th>Per decision</th></tr>${Object.keys(S.byPos).map((k) => row(k, S.byPos[k])).join('')}</table>` : '<p class="mute" style="margin-top:14px">Play a few hands and your leaks will show up here.</p>'}
      ${S.worst.length ? `<h3 style="margin-top:16px;font-size:.95rem">Biggest mistakes</h3><div class="hh">${S.worst.map((x) => { const m = S.getM(x.d); return `<button data-hand="${x.h.no}"><span>Hand ${x.h.no} · ${esc(x.d.street)} · ${x.d.hole.map((c) => cardEl(c, 'sm')).join('')}</span><span class="net dn">−${m.lossBB.toFixed(1)} bb</span></button>`; }).join('')}</div>` : ''}
      ${n ? `<h3 style="margin-top:16px;font-size:.95rem">Hand history</h3><div class="hh">${S.hands.slice().reverse().slice(0, 40).map((h) => `<button data-hand="${h.no}"><span>Hand ${h.no} · ${h.pos} · ${h.hole.map((c) => cardEl(c, 'sm')).join('')}</span><span class="net ${h.net >= 0 ? 'up' : 'dn'}">${h.net >= 0 ? '+' : ''}${num(h.net)} bb</span></button>`).join('')}</div>` : ''}`;
    const m = modal(html);
    $$('[data-hand]', m).forEach((b) => (b.onclick = () => { const h = session.hands.find((x) => x.no === +b.dataset.hand); m.remove(); rv.open = true; rv.rec = h; renderGame(); }));
  }
  function openGuide() {
    const html = `<h2>Bot guide</h2><p class="mute" style="font-size:.88rem;line-height:1.5">Stats were measured by simulation at a 6-max table. VPIP is how often a bot voluntarily puts chips in preflop, PFR how often it raises preflop, aggression is bets and raises divided by calls.</p>
      <div class="guide">${STYLES.map((s) => `<div class="it"><b>${esc(s.name)} <span class="mute" style="font-weight:500">· ${esc(s.tags)}</span></b><small>${esc(s.desc)}</small><div class="stats" style="display:flex;gap:6px;flex-wrap:wrap">${statPills(s.id)}</div></div>`).join('')}</div>`;
    modal(html);
  }
  function openOptions() {
    const m = modal(`<h2>Options</h2><div class="row" style="flex-direction:column;align-items:stretch">
      <label class="toggle"><input type="checkbox" data-set="reveal" ${settings.reveal ? 'checked' : ''}><span>Show opponent playstyles</span></label>
      <label class="toggle"><input type="checkbox" data-set="hud" ${settings.hud ? 'checked' : ''}><span>Show live stats (VPIP / PFR)</span></label>
      <label class="toggle"><input type="checkbox" data-set="odds" ${settings.odds ? 'checked' : ''}><span>Show pot odds</span></label>
      <label class="toggle"><input type="checkbox" data-set="fast" ${settings.fast ? 'checked' : ''}><span>Fast bots</span></label></div>`);
    $$('[data-set]', m).forEach((c) => (c.onchange = () => { settings[c.dataset.set] = c.checked; saveSet(); renderGame(); }));
  }

  // expose a few hooks for testing
  globalThis.__pl = { get g() { return g; }, get rec() { return lastRec; }, startSession, renderSetup, cfg, settings };
  renderSetup();
})();
