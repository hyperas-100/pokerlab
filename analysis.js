/* PokerLab review engine.
   Reconstructs each of your decisions after a hand ends, builds a model of every opponent's range from what they did,
   and compares the EV of fold / call / raise using Monte Carlo sampling.
   All numbers are estimates: they rank your options, they are not a solver. */
(function () {
  const PK = (globalThis.PK = globalThis.PK || {});
  const E = PK.Engine || require('./engine.js');
  const R = PK.Range || require('./ranks.js');
  const B = PK.Bots || require('./bots.js');
  const cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const N_DEEP = 900;

  const TIPS = {
    nit: 'Fold to its aggression unless you have a strong hand, and steal its blinds often.',
    tag: 'Play fundamentals against it: position, pot odds, and no hero calls without a reason.',
    lag: 'Let it bluff into you. Call down with medium-strength hands and 3-bet your premiums.',
    station: 'Never bluff it. Value bet thinly and bet bigger with your good hands.',
    maniac: 'Tighten up, trap with strong hands and let it keep betting. Call down lighter than normal.',
    fish: 'Isolate it with raises and value bet relentlessly. It rarely folds a pair.',
    scared: 'Bluff and apply pressure. When it does bet or raise, give it credit.',
    trapper: 'Be careful when it checks to you on dry boards: it may be holding a monster.',
    bluffer: 'Call down more often than you normally would. Its bets are often weaker than they look.',
    shover: 'Wait for a real hand and call its jams wide enough, since its range is wide.',
    limper: 'Raise to isolate it in position and play bigger pots when you hold the stronger hand.',
    threebetter: 'Do not over-fold to its 3-bets. 4-bet your strong hands and call with the hands that play well.',
    gto: 'Hard to exploit. Focus on your own fundamentals and avoid obvious leaks.',
    draw: 'Charge draws a high price: bet big when you are ahead and be wary when the draw completes.',
    minraiser: 'Its small sizing offers great odds. Defend wide, then outplay it after the flop.',
    overfolder: 'Fire a second barrel. It gives up most hands to continued pressure.',
    steamer: 'Watch its mood. After it loses a big pot, widen your calling range against it.',
    cbetter: 'Float its flop c-bet and take the pot when it checks the turn.',
    polarizer: 'Its big bets are monsters or bluffs. Call with the top of your range and fold the middle.',
    hero: 'Do not bluff it. Value bet thin, including on the river.',
    checkraiser: 'Beware of betting into it. Sometimes check back and let it show its hand.',
    oldman: 'When it raises, fold. Steal its blinds and stay out of its way when it finally wakes up.',
    tourist: 'No pattern to read. Stay disciplined and play your hand on its merits.',
    shark: 'Mix up your play: it adapts to what you do too much of.',
    whale: 'Value bet a lot and avoid fancy plays. It calls too wide and pays off good hands.',
  };

  /* ---------- strength / ranges ---------- */
  const PAIR = 1 << 20;
  const strCache = new Map();
  function strength(combo, board) {
    if (board.length < 3) return 1 - R.MID[R.keyOf(combo[0], combo[1])];
    const key = combo[0] * 52 + combo[1] + ':' + board.join(',');
    const hit = strCache.get(key); if (hit !== undefined) return hit;
    let s = E.eval7(combo.concat(board));
    if (board.length < 5) {
      const d = R.draws(combo, board); let floor = 0;
      if (d.fd && d.oesd) floor = PAIR | (10 << 16); else if (d.fd) floor = PAIR | (8 << 16); else if (d.oesd) floor = PAIR | (6 << 16); else if (d.gut) floor = PAIR | (3 << 16);
      if (s < floor) s = floor;
    }
    if (strCache.size > 60000) strCache.clear();
    strCache.set(key, s); return s;
  }
  function callRangeFor(P, pos, toBB, n) {
    let call = P.call;
    if (pos === 'BB') call *= toBB <= 2.6 ? 3.8 : toBB <= 3.6 ? 3.1 : toBB <= 5 ? 2 : 1.1;
    else if (pos === 'SB') call *= 0.9;
    else if (pos === 'BTN' || pos === 'CO' || pos === 'HJ') call *= 1.35;
    if (toBB > 9) call *= 0.5; else if (toBB > 6) call *= 0.75;
    if (n === 2) call *= 1.8;
    return cl(call, 0, 0.75);
  }
  function openPctFor(g, P, pos) {
    const pm = g.n === 2 ? (pos === 'BTN' ? 3.2 : 1) : B.posMult(g, pos);
    return cl(P.open * pm, 0.02, 0.97);
  }
  function preflopWindow(g, P, a) {
    const open = openPctFor(g, P, a.pos), toBB = a.currentBet / g.bb;
    if (a.type === 'raise') {
      if (a.preflopRaises === 0) return [0, open];
      if (a.preflopRaises === 1) return [0, Math.max(0.012, P.threeBet * (P.bluff3 > 0.2 ? 1.7 : 1.2))];
      return [0, Math.max(0.02, P.fourBet * 1.5)];
    }
    if (a.type === 'call') {
      if (a.preflopRaises === 0) return [P.limp > 0 ? P.limpRaiseTop : 0.05, Math.min(0.95, open + P.limpExtra)];
      if (a.preflopRaises === 1) return [P.threeBet * 0.8, Math.max(P.threeBet * 0.8 + 0.02, callRangeFor(P, a.pos, toBB, g.n))];
      return [P.fourBet * 0.7, Math.max(P.fourBet * 0.7 + 0.02, P.call3)];
    }
    if (a.type === 'check') return [P.iso * 0.7, 1];
    return null;
  }
  /* Range entries are {c: combo, w: weight}. Each villain action re-weights hands: strong hands keep full weight,
     weak hands keep a small weight (bluffs / float calls) so bluffs survive across streets instead of being filtered out. */
  function narrow(entries, a, P, mode, rnd) {
    if (entries.length < 12) return entries;
    const sc = entries.map((e) => ({ e, s: strength(e.c, a.board) + rnd() * 0.5 })).sort((x, y) => y.s - x.s);
    let total = 0; for (const x of sc) total += x.e.w;
    const rw = mode === 'bot' ? P.rangeWidth : 1;
    const bluffB = mode === 'bot' ? cl(P.bluff * 0.9, 0.02, 0.4) : 0.12;
    let keepQ = 1, lowMult = 1, topQ = 0, topMult = 1;
    if (a.type === 'raise') {
      const frac = a.toCall > 0 ? a.to / Math.max(1, a.potBefore) : a.add / Math.max(1, a.potBefore);
      const base = frac <= 0.4 ? 0.66 : frac <= 0.75 ? 0.52 : frac <= 1.1 ? 0.42 : 0.3;
      keepQ = cl(base * (a.toCall > 0 ? 0.7 : 1) * rw, 0.07, 0.88); lowMult = a.toCall > 0 ? bluffB * 0.5 : bluffB;
    } else if (a.type === 'call') { keepQ = cl(0.68 * rw, 0.12, 0.92); lowMult = 0.06; }
    else if (a.type === 'check') { if (P.slow < 0.3) { topQ = 0.1; topMult = 0.35; } }
    else return entries;
    let cum = 0; const out = [];
    for (const x of sc) {
      const q = cum / total; cum += x.e.w;
      const m = q < topQ ? topMult : q <= keepQ ? 1 : lowMult;
      if (x.e.w * m > 0.002) out.push({ c: x.e.c, w: x.e.w * m });
    }
    return out;
  }
  function buildRange(g, v, idx, dead, mode, rnd) {
    const P = mode === 'bot' ? B.params(v.style) : B.params('tag');
    const acts = g.actions.slice(0, idx).filter((a) => a.pid === v.id);
    let lo = 0, hi = 1;
    for (const a of acts) {
      if (a.street !== 'preflop') continue;
      const w = preflopWindow(g, P, a); if (!w) continue;
      const nlo = Math.max(lo, w[0]), nhi = Math.min(hi, w[1]);
      if (nhi - nlo > 0.015) { lo = nlo; hi = nhi; } else { lo = w[0]; hi = w[1]; }
    }
    let base = R.pool(lo, hi, dead);
    if (base.length < 10) base = R.pool(0, Math.min(1, hi + 0.12), dead);
    let entries = base.map((c) => ({ c, w: 1 }));
    for (const a of acts) if (a.street !== 'preflop') entries = narrow(entries, a, P, mode, rnd);
    let size = 0; const pool = [];
    for (const e of entries) { size += e.w; const reps = Math.max(1, Math.round(e.w * 12)); for (let k = 0; k < reps; k++) pool.push(e.c); }
    return { pool, size, lo, hi, P };
  }

  /* ---------- context at one of the hero's decisions ---------- */
  function contextAt(g, idx) {
    const a = g.actions[idx], hero = g.players[a.pid];
    const folded = new Set(g.actions.slice(0, idx).filter((x) => x.type === 'fold').map((x) => x.pid));
    const posts = {}; for (const l of g.log) if (l.t === 'post') posts[l.pid] = (posts[l.pid] || 0) + l.amount;
    const villains = [];
    for (const p of g.players) {
      if (p.id === a.pid || folded.has(p.id)) continue;
      const prev = g.actions.slice(0, idx).filter((x) => x.pid === p.id);
      let committed = posts[p.id] || 0; for (const x of prev) committed += x.add;
      let bet = a.street === 'preflop' ? posts[p.id] || 0 : 0;
      for (const x of prev) if (x.street === a.street) bet = x.to;
      const stack = p.handStart - committed;
      villains.push({ id: p.id, p, name: p.name, style: p.style, pos: p.pos, bet, stack, allIn: stack <= 0, acted: prev.length > 0, actedNow: a.street === 'preflop' ? prev.length > 0 : prev.some((x) => x.street === a.street), raisedPre: prev.some((x) => x.street === 'preflop' && x.type === 'raise'), order: B.postflopOrder(g, p.id) });
    }
    const ip = villains.every((v) => B.postflopOrder(g, a.pid) > v.order);
    return { g, a, idx, hero, villains, P: a.potBefore, C: a.toCall, heroBet: a.betBefore, stack: a.stackBefore, bb: g.bb, street: a.street, ip, board: a.board, hole: a.hole };
  }

  /* ---------- sampling scenarios ---------- */
  function sampleScenarios(ctx, ranges, N, rnd) {
    const nV = ranges.length, hs = new Float64Array(N), fin = ranges.map(() => new Float64Array(N)), cur = ranges.map(() => new Float64Array(N));
    const used = new Uint8Array(52), board = ctx.board, hole = ctx.hole;
    const rem = []; for (let c = 0; c < 52; c++) if (hole.indexOf(c) < 0 && board.indexOf(c) < 0) rem.push(c);
    const need = 5 - board.length, full = new Array(7);
    const curCache = ranges.map(() => new Map());
    let n = 0, guard = 0;
    while (n < N && guard++ < N * 4) {
      used.fill(0); used[hole[0]] = used[hole[1]] = 1; for (const c of board) used[c] = 1;
      const picks = []; let ok = true;
      for (let i = 0; i < nV; i++) {
        const pool = ranges[i].pool; let pick = null;
        for (let t = 0; t < 30; t++) { const x = pool[(rnd() * pool.length) | 0]; if (!used[x[0]] && !used[x[1]]) { pick = x; break; } }
        if (!pick) { ok = false; break; }
        used[pick[0]] = used[pick[1]] = 1; picks.push(pick);
      }
      if (!ok) continue;
      const bd = board.slice();
      for (let i = 0; i < need; i++) { let c; do { c = rem[(rnd() * rem.length) | 0]; } while (used[c]); used[c] = 1; bd.push(c); }
      for (let j = 0; j < 5; j++) full[2 + j] = bd[j];
      full[0] = hole[0]; full[1] = hole[1]; hs[n] = E.eval7(full);
      for (let i = 0; i < nV; i++) {
        full[0] = picks[i][0]; full[1] = picks[i][1]; fin[i][n] = E.eval7(full);
        const k = picks[i][0] * 52 + picks[i][1]; let cs = curCache[i].get(k);
        if (cs === undefined) { cs = strength(picks[i], board); curCache[i].set(k, cs); }
        cur[i][n] = cs;
      }
      n++;
    }
    return { n, hs, fin, cur };
  }
  function shareVs(hs, finList, idxs, s) {
    let best = -1, nb = 0;
    for (const i of idxs) { const f = finList[i][s]; if (f > best) { best = f; nb = 1; } else if (f === best) nb++; }
    if (hs[s] > best) return 1; if (hs[s] === best) return 1 / (nb + 1); return 0;
  }
  function quantile(arr, n, q) { const a = Float64Array.from(arr.subarray(0, n)).sort(); return a[Math.min(n - 1, Math.max(0, Math.floor(q * n)))]; }

  function raiseCandidates(ctx) {
    const a = ctx.a, bb = ctx.bb, P = ctx.P, out = [];
    if (!a.canRaise) return out;
    const add = (to, label) => { to = Math.round(cl(to, a.minTo, a.maxTo)); if (!out.some((o) => o.to === to)) out.push({ to, label }); };
    const stackBB = (a.stackBefore + a.betBefore) / bb;
    if (a.street === 'preflop') {
      if (a.preflopRaises === 0) { const L = a.limpers; add(bb * (2 + L), 'small open'); add(bb * (2.5 + L), 'standard open'); add(bb * (3 + L), 'big open'); }
      else if (a.preflopRaises === 1) { const m = ctx.ip ? [3, 3.7] : [3.8, 4.6]; add(a.currentBet * m[0], '3-bet'); add(a.currentBet * m[1], 'big 3-bet'); }
      else { add(a.currentBet * 2.2, '4-bet'); add(a.currentBet * 2.6, 'big 4-bet'); }
    } else if (a.toCall === 0) { for (const f of [0.33, 0.5, 0.75, 1]) add(Math.max(bb, P * f), Math.round(f * 100) + '% pot'); }
    else { add(a.currentBet * 2.5, 'raise 2.5x'); add(a.currentBet + (P + a.toCall) * 0.75, 'raise 3/4 pot'); add(a.currentBet + (P + a.toCall), 'pot-size raise'); }
    const spr = (a.stackBefore + a.betBefore) / Math.max(1, P + a.toCall);
    const gateAllIn = a.street === 'preflop' ? (a.preflopRaises >= 2 || stackBB <= (a.preflopRaises === 0 ? 40 : 70)) : spr <= 3;
    if (gateAllIn) add(a.maxTo, 'all-in');
    return out;
  }

  function evalOptions(ctx, ranges, mode, rnd, N) {
    const sc = sampleScenarios(ctx, ranges, N, rnd), n = sc.n, a = ctx.a, bb = ctx.bb, P = ctx.P;
    const nV = ranges.length, all = ranges.map((_, i) => i);
    if (!n) return null;
    let callSet = all.filter((i) => ctx.villains[i].actedNow || ctx.villains[i].allIn); if (!callSet.length) callSet = all;
    let eqAll = 0; for (let s = 0; s < n; s++) eqAll += shareVs(sc.hs, sc.fin, callSet, s); eqAll /= n;
    const river = ctx.street === 'river';
    const Rcall = river || a.toCall >= a.stackBefore ? 1 : ctx.ip ? 0.97 : (ctx.street === 'preflop' ? 0.88 : 0.92);
    const opts = [];
    const req = a.toCall > 0 ? a.toCall / (P + a.toCall) : 0;
    if (a.toCall > 0) opts.push({ key: 'fold', label: 'Fold', ev: 0 });
    opts.push({ key: a.toCall > 0 ? 'call' : 'check', label: a.toCall > 0 ? 'Call ' + fmtBB(a.toCall, bb) : 'Check', ev: Rcall * eqAll * (P + a.toCall) - a.toCall });
    let foldEqBest = 0;
    const evRaise = (X) => {
      const I = X - a.betBefore, Rr = river || X >= a.maxTo ? 1 : 0.94;
      const D = ranges.map((_, i) => { const v = ctx.villains[i]; return v.allIn ? 0 : cl(X - v.bet, 0, v.stack); });
      const thr = ranges.map((r, i) => {
        const v = ctx.villains[i]; if (v.allIn || D[i] <= 0) return -Infinity;
        const stick = mode === 'bot' ? r.P.stick : 1;
        let c;
        if (ctx.street === 'preflop') {
          const Pv = r.P, k = a.preflopRaises + 1, toBBx = X / bb;
          let rr;
          if (k === 1) rr = (callRangeFor(Pv, v.pos, toBBx, ctx.g.n) + Pv.threeBet) * cl(3 / Math.max(toBBx, 1.5), 0.5, 1.4);
          else if (k === 2) rr = (Pv.call3 + Pv.fourBet) * (v.actedNow ? 1 : 0.5);
          else { const c4 = B.cont4(Pv, v.raisedPre); rr = c4.call + c4.shove; }
          c = cl(rr / Math.max(r.hi, rr, 0.02), 0.03, 0.95);
        } else c = cl(((P + I - D[i]) / (P + I)) * stick, 0.12, 0.97);
        return quantile(sc.cur[i], n, 1 - c);
      });
      // villains who continue with their strongest hands may re-raise; if hero's hand cannot stand that he folds and loses I
      const strongThr = ranges.map((r, i) => {
        const v = ctx.villains[i]; if (v.allIn || D[i] <= 0 || thr[i] === -Infinity) return Infinity;
        const frac = mode === 'bot' ? 0.28 * r.P.raiseFreq : 0.24;
        const above = []; for (let s = 0; s < n; s++) if (sc.cur[i][s] >= thr[i]) above.push(sc.cur[i][s]);
        if (above.length < 10) return Infinity;
        above.sort((x, y) => x - y); return above[Math.min(above.length - 1, Math.floor((1 - frac) * above.length))];
      });
      let strongSum = 0, strongN = 0;
      const rec = [];
      for (let s = 0; s < n; s++) {
        const cont = []; let pot = P + I, strong = false;
        for (let i = 0; i < nV; i++) if (ctx.villains[i].allIn || D[i] <= 0 || sc.cur[i][s] >= thr[i]) { cont.push(i); pot += D[i]; if (X < a.maxTo && sc.cur[i][s] >= strongThr[i]) strong = true; }
        const sh = cont.length ? shareVs(sc.hs, sc.fin, cont, s) : 0;
        if (strong) { strongSum += sh; strongN++; }
        rec.push({ cont: cont.length, pot, sh, strong });
      }
      const foldToStrong = strongN > 0 && strongSum / strongN < 0.42;
      let ev = 0, noCont = 0;
      for (const r of rec) {
        if (!r.cont) { ev += P; noCont++; }
        else if (r.strong && foldToStrong) ev -= I;
        else ev += Rr * r.sh * r.pot - I;
      }
      return { ev: ev / n, fold: noCont / n };
    };
    for (const c of raiseCandidates(ctx)) { const r = evRaise(c.to); opts.push({ key: 'raise', to: c.to, label: (c.to >= a.maxTo ? 'All-in ' : 'Raise to ') + fmtBB(c.to, bb) + ' (' + c.label + ')', ev: r.ev, foldEq: r.fold }); }
    const ref = Math.max(0, opts.find((o) => o.key !== 'raise' && o.key !== 'fold').ev);
    const shrink = eqAll < 0.45 ? 0.55 : 0.8;
    for (const o of opts) if (o.key === 'raise') { o.rawEv = o.ev; o.ev = ref + shrink * (o.ev - ref); }
    // the hero's exact action
    let chosen;
    if (a.type === 'raise') { const r = evRaise(a.to); r.ev = ref + shrink * (r.ev - ref); chosen = { key: 'raise', to: a.to, label: (a.allIn ? 'All-in ' : (a.toCall === 0 ? 'Bet ' : 'Raise to ')) + fmtBB(a.to, bb), ev: r.ev, foldEq: r.fold, you: true }; }
    else chosen = Object.assign({}, opts.find((o) => o.key === (a.type === 'fold' ? 'fold' : a.toCall > 0 ? 'call' : 'check')), { you: true });
    return { opts, chosen, eqAll, req, n };
  }

  function gradeOf(loss, pot, bb) {
    const k = cl(0.6 + (pot / bb) / 30, 0.8, 2.5), l = loss / bb;
    if (loss <= 0.0001 || l < 0.12 * k) return 'Best';
    if (l < 0.45 * k) return 'Good';
    if (l < 1.2 * k) return 'Inaccuracy';
    if (l < 3 * k) return 'Mistake';
    return 'Blunder';
  }

  /* ---------- text helpers ---------- */
  const fmtBB = (x, bb) => (x / bb).toFixed(1).replace(/\.0$/, '') + ' bb';
  const fmtCards = (cs) => cs.map(E.cardStr).join(' ');
  const bbs = (x, bb) => (x / bb).toFixed(1).replace(/\.0$/, '') + ' bb';
  function handDesc(hole, board) {
    if (board.length < 3) return R.keyOf(hole[0], hole[1]) + ' (top ' + Math.max(1, Math.round(R.pct(hole) * 100)) + '% of starting hands)';
    return E.handName(E.eval7(hole.concat(board)));
  }
  function villainText(g, v, rg, mode) {
    const P = mode === 'bot' ? B.params(v.style) : B.params('tag');
    const st = B.BY_ID[v.style];
    const widthPct = Math.max(1, Math.round(rg.size / 1326 * 100));
    return { id: v.id, name: v.name, pos: v.pos, style: v.style, styleName: st ? st.name : '', tip: TIPS[v.style] || '', rangePct: widthPct, text: (st ? st.name + ' on ' + v.pos : v.pos) + ': range about ' + widthPct + '% of hands' };
  }

  /* ---------- quick (rule based) advice ---------- */
  function quickPreflop(ctx) {
    const a = ctx.a, g = ctx.g, P = B.params('tag'), pct = R.pct(a.hole), bb = ctx.bb;
    const pm = g.n === 2 ? (a.pos === 'BTN' ? 3.2 : 1) : B.posMult(g, a.pos), toBB = a.currentBet / bb;
    const lines = []; let rec, edge = 1, thr;
    const stackBB = (a.stackBefore + a.betBefore) / bb;
    if (stackBB <= 12) {
      thr = a.preflopRaises === 0 ? Math.min(pm, 1.8) * 0.28 : 0.12;
      rec = pct <= thr ? 'raise' : (a.toCall === 0 ? 'check' : 'fold'); if (rec === 'raise' && a.preflopRaises > 0) rec = 'call';
      lines.push('Short stack (' + Math.round(stackBB) + ' bb): play push/fold. Shove roughly the top ' + Math.round(thr * 100) + '% of hands from here.');
    } else if (a.preflopRaises === 0) {
      if (a.toCall === 0) { thr = P.iso; rec = pct <= thr ? 'raise' : 'check'; lines.push('Big blind with no raise: check unless you hold a strong hand worth raising for value.'); }
      else { thr = openPctFor(g, P, a.pos); rec = pct <= thr ? 'raise' : 'fold'; lines.push('Unopened pot from ' + a.pos + ': a solid player opens about the top ' + Math.round(thr * 100) + '% of hands. Your hand is in the top ' + Math.round(pct * 100) + '%.'); if (a.limpers) lines.push('With ' + a.limpers + ' limper(s) in, raise bigger and tighten your range slightly.'); }
    } else if (a.preflopRaises === 1) {
      const three = P.threeBet, call = callRangeFor(P, a.pos, toBB, g.n);
      thr = pct <= three ? three : call; rec = pct <= three ? 'raise' : pct <= call ? 'call' : 'fold';
      lines.push('Facing a raise to ' + bbs(a.currentBet, bb) + ' from ' + a.pos + ': re-raise about the top ' + Math.round(three * 100) + '%, call up to about the top ' + Math.round(call * 100) + '%, fold the rest. Your hand: top ' + Math.round(pct * 100) + '%.');
      edge = pct <= three ? three : call;
    } else {
      const four = P.fourBet, call3 = P.call3; thr = pct <= four ? four : call3;
      rec = pct <= four ? 'raise' : pct <= call3 ? 'call' : 'fold';
      lines.push('Facing a 3-bet or bigger: continue with only the strongest hands (top ' + Math.round(call3 * 100) + '% to call, top ' + Math.round(four * 100) + '% to 4-bet). Your hand: top ' + Math.round(pct * 100) + '%.');
    }
    const border = Math.abs(pct - thr) / Math.max(thr, 0.02) < 0.3;
    return { rec, lines, border };
  }
  function quickPost(ctx, deepStd) {
    const a = ctx.a, P = ctx.P, C = a.toCall, bb = ctx.bb, lines = [];
    const eq = deepStd.eqAll, req = deepStd.req; let rec, border = false;
    lines.push('Your hand: ' + handDesc(ctx.hole, ctx.board) + '. Estimated equity vs a typical range for these opponents: ' + Math.round(eq * 100) + '%.');
    if (C > 0) {
      lines.push('Pot odds: you call ' + bbs(C, bb) + ' to win ' + bbs(P, bb) + ', so you need about ' + Math.round(req * 100) + '% equity.');
      if (eq >= 0.72 && a.canRaise) rec = 'raise'; else if (eq >= req + 0.02) rec = 'call'; else rec = 'fold';
      border = Math.abs(eq - req) < 0.06 || (rec === 'raise' && eq < 0.8) || (rec === 'call' && eq > 0.64);
    } else {
      if (eq >= 0.62 && a.canRaise) rec = 'raise'; else rec = 'check';
      const dr = ctx.street === 'river' ? null : R.draws(ctx.hole, ctx.board);
      if (rec === 'check' && dr && (dr.fd || dr.oesd) && ctx.villains.length === 1 && a.canRaise) { border = true; lines.push('You have a draw: a bet is a reasonable semi-bluff when heads-up.'); }
      border = border || (eq > 0.5 && eq < 0.68);
      lines.push(rec === 'raise' ? 'Strong enough to bet for value (about 50-75% of the pot).' : 'Not strong enough to bet for value. Check and try to see a cheap card or showdown.');
    }
    return { rec, lines, border };
  }
  const heroCat = (a) => (a.type === 'raise' ? 'raise' : a.type);
  function quickGrade(rec, a, border) {
    const h = heroCat(a); const same = h === rec || (h === 'call' && rec === 'check') || (h === 'check' && rec === 'call');
    if (same) return 'Good';
    if (border) return 'Ok';
    return 'Mistake';
  }

  /* ---------- explanations ---------- */
  function deepLines(ctx, res, villainInfos, mode) {
    const a = ctx.a, bb = ctx.bb, L = [];
    const best = res.opts.reduce((m, o) => (o.ev > m.ev ? o : m), res.opts[0]);
    L.push('Your hand: ' + handDesc(ctx.hole, ctx.board) + (ctx.board.length ? ' on ' + fmtCards(ctx.board) : '') + '.');
    L.push('Pot ' + bbs(ctx.P, bb) + (a.toCall > 0 ? ', you face ' + bbs(a.toCall, bb) + ' (need ' + Math.round(res.req * 100) + '% equity to call).' : ', no bet to you.') + ' Effective stack ' + bbs(a.stackBefore + a.betBefore, bb) + '. ' + (ctx.ip ? 'You are in position.' : 'You are out of position.'));
    L.push('Your equity against their estimated range' + (ctx.villains.length > 1 ? 's' : '') + ': about ' + Math.round(res.eqAll * 100) + '%.');
    const ch = res.chosen, d = best.ev - ch.ev;
    if (ch.key === 'fold' && a.toCall > 0 && res.eqAll > res.req + 0.05) L.push('Folding gave up a profitable spot: you only needed ' + Math.round(res.req * 100) + '% equity but have about ' + Math.round(res.eqAll * 100) + '%.');
    if (ch.key === 'call' && res.eqAll < res.req - 0.05) L.push('This call is short on equity (' + Math.round(res.eqAll * 100) + '% vs the ' + Math.round(res.req * 100) + '% you need). It only works if you expect to win a lot more on later streets.');
    if (ch.key === 'raise' && ch.foldEq != null) {
      L.push('Opponents all fold to this ' + (a.toCall === 0 ? 'bet' : 'raise') + ' about ' + Math.round(ch.foldEq * 100) + '% of the time.' + (mode === 'bot' && ctx.villains.length === 1 ? ' Against this player that is ' + (ch.foldEq < 0.25 ? 'low, so bluffs lose value and value bets can be bigger.' : ch.foldEq > 0.55 ? 'high, so bluffing works well.' : 'about average.') : ''));
      if (res.eqAll < 0.3 && ch.foldEq < 0.35 && d > 0.3 * bb) L.push('Without much equity and with little fold equity, this bluff needs opponents to fold more often than they do.');
    }
    if ((ch.key === 'check' || ch.key === 'call') && best.key === 'raise' && d > 0.2 * bb) L.push((ch.key === 'check' ? 'Betting' : 'Raising') + ' was worth more here' + (best.foldEq != null && best.foldEq > 0.25 ? ' because opponents fold about ' + Math.round(best.foldEq * 100) + '% of the time.' : ' because you are ahead of enough of their hands.'));
    return L;
  }

  /* ---------- decision analysis ---------- */
  function analyzeDecision(g, idx, opts) {
    opts = opts || {};
    const rnd = opts.rnd || Math.random, ctx = contextAt(g, idx), a = ctx.a, bb = g.bb;
    const dead = ctx.hole.concat(ctx.board);
    const out = { idx, street: a.street, pos: a.pos, hole: a.hole.slice(), board: a.board.slice(), pot: a.potBefore, toCall: a.toCall, stack: a.stackBefore, bb, type: a.type, to: a.to, allIn: a.allIn, ip: ctx.ip };
    const modes = {};
    const rangesByMode = {};
    for (const mode of ['bot', 'std']) {
      const ranges = ctx.villains.map((v) => buildRange(g, v, idx, dead, mode, rnd));
      rangesByMode[mode] = ranges;
      const res = evalOptions(ctx, ranges, mode, rnd, opts.N || N_DEEP);
      if (!res) { modes[mode] = null; continue; }
      const all = res.opts.slice();
      if (res.chosen.key === 'raise' && !all.some((o) => o.key === 'raise' && o.to === res.chosen.to)) all.push(Object.assign({}, res.chosen, { label: res.chosen.label + ' (your play)' }));
      const best = all.reduce((m, o) => (o.ev > m.ev ? o : m), all[0]);
      let loss = Math.max(0, best.ev - res.chosen.ev);
      if (res.chosen.key === best.key && res.chosen.key !== 'fold') loss *= 0.3; // same kind of play, only the size differs
      const grade = gradeOf(loss, a.potBefore + a.toCall, bb);
      const list = all.map((o) => ({ label: o.label, key: o.key, to: o.to, ev: o.ev, evBB: o.ev / bb, foldEq: o.foldEq, best: o === best }));
      modes[mode] = { opts: list, chosen: { label: res.chosen.label, ev: res.chosen.ev, evBB: res.chosen.ev / bb, foldEq: res.chosen.foldEq }, best: { label: best.label, ev: best.ev, evBB: best.ev / bb }, lossBB: loss / bb, grade, eq: res.eqAll, req: res.req, close: loss / bb < 0.35, lines: deepLines(ctx, Object.assign({}, res, { opts: all }), null, mode) };
    }
    out.villains = ctx.villains.map((v, i) => villainText(g, v, rangesByMode.bot[i], 'bot'));
    out.villainsStd = ctx.villains.map((v, i) => villainText(g, v, rangesByMode.std[i], 'std'));
    out.deep = modes;
    // quick advice
    const q = a.street === 'preflop' ? quickPreflop(ctx) : (modes.std ? quickPost(ctx, { eqAll: modes.std.eq, req: modes.std.req }) : { rec: 'check', lines: [], border: true });
    const recLabel = { raise: a.toCall === 0 && a.street !== 'preflop' ? 'Bet' : 'Raise', call: 'Call', fold: 'Fold', check: 'Check' }[q.rec] || q.rec;
    out.quick = { rec: q.rec, recLabel, lines: q.lines, grade: quickGrade(q.rec, a, q.border) };
    return out;
  }

  function analyzeHand(g, heroId, opts) {
    const idxs = []; g.actions.forEach((a, i) => { if (a.pid === heroId) idxs.push(i); });
    const decisions = idxs.filter((i) => {
      const a = g.actions[i]; return !(a.type === 'check' && a.toCall === 0 && !a.canRaise) && !(a.toCall === 0 && !a.canRaise);
    }).map((i) => analyzeDecision(g, i, opts));
    const hero = g.players[heroId];
    return { handNo: g.handNo, hole: hero.hole.slice(), board: g.board.slice(), pos: hero.pos, netBB: hero.net / g.bb, decisions, result: g.result, wasShowdown: g.result && !g.result.uncontested };
  }

  PK.Review = { analyzeHand, analyzeDecision, gradeOf, TIPS, strength };
  if (typeof module !== 'undefined') module.exports = PK.Review;
})();
