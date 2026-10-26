/* PokerLab bots: 25 parametric playstyles sharing one decision engine. */
(function () {
  const PK = (globalThis.PK = globalThis.PK || {});
  const R = PK.Range || require('./ranks.js');

  const BASE = {
    // preflop (fractions are "top X of all hands")
    open: 0.22, limp: 0, limpExtra: 0, limpRaiseTop: 0.04, openSize: 2.6, threeBet: 0.06, threeSize: 3, bluff3: 0.15,
    call: 0.09, call3: 0.06, fourBet: 0.025, fiveBet: 0.012, call4: 0.02, slowPre: 0, iso: 0.10, pushBelow: 12, jam: 0,
    // postflop
    valueBet: 0.66, thinBet: 0.54, valFreq: 0.9, thinFreq: 0.3, bluff: 0.08, cbet: 0.65, semi: 0.45,
    valSize: 0.66, bluffSize: 0.6, sizeVar: 0.15, overbet: 0, slow: 0.1,
    raiseVal: 0.82, raiseFreq: 0.85, bluffRaise: 0.06, callMult: 1, respect: 0.7, drawLove: 0.5, noise: 0.03,
    heroRiver: 0, giveUpTurn: 0, checkRaise: 0,
    // behaviours
    tiltable: 0, adaptive: 0, chaos: 0,
    // used by the review model
    rangeWidth: 1, stick: 1,
  };

  const S = (id, name, tags, desc, p) => ({ id, name, tags, desc, p });
  const STYLES = [
    S('nit', 'Rock', 'Tight / Passive', 'Plays only premium hands and folds to pressure. Rarely bluffs. When a Rock bets big, believe it.',
      { open: 0.11, call: 0.05, threeBet: 0.025, call3: 0.025, fourBet: 0.015, fiveBet: 0.01, call4: 0.015, valueBet: 0.72, thinBet: 0.62, valFreq: 0.85, thinFreq: 0.08, bluff: 0.02, cbet: 0.45, semi: 0.1, callMult: 1.25, respect: 1.2, bluff3: 0, rangeWidth: 0.7, stick: 0.7 }),
    S('tag', 'Solid Reg', 'Tight / Aggressive', 'The textbook winning player: sensible ranges by position, bets for value, bluffs a little.',
      {}),
    S('lag', 'Aggro Reg', 'Loose / Aggressive', 'Opens a lot, 3-bets light and fires multiple barrels. Pressure is the whole plan.',
      { open: 0.30, call: 0.13, threeBet: 0.10, call3: 0.09, fourBet: 0.04, bluff3: 0.35, valueBet: 0.58, thinBet: 0.46, thinFreq: 0.55, bluff: 0.22, cbet: 0.8, semi: 0.7, valSize: 0.72, bluffSize: 0.7, callMult: 0.9, respect: 0.5, bluffRaise: 0.14, rangeWidth: 1.25 }),
    S('station', 'Calling Station', 'Loose / Passive', 'Calls with anything, almost never raises or folds. Do not bluff it. Bet your good hands for value.',
      { open: 0.10, limp: 0.55, limpExtra: 0.25, call: 0.30, threeBet: 0.02, call3: 0.15, fourBet: 0.012, valueBet: 0.72, thinBet: 0.62, valFreq: 0.6, thinFreq: 0.05, bluff: 0.01, cbet: 0.2, semi: 0.1, callMult: 0.62, respect: 0.05, raiseVal: 0.92, raiseFreq: 0.5, bluffRaise: 0, drawLove: 1, heroRiver: 0.4, rangeWidth: 1.5, stick: 1.7 }),
    S('maniac', 'Maniac', 'Very loose / Very aggressive', 'Raises and bets constantly with huge sizes. Wins big pots and loses them too. Let it hang itself.',
      { open: 0.55, call: 0.15, threeBet: 0.22, call3: 0.15, fourBet: 0.08, bluff3: 0.5, openSize: 3.4, threeSize: 3.4, valueBet: 0.48, thinBet: 0.38, valFreq: 0.95, thinFreq: 0.8, bluff: 0.45, cbet: 0.95, semi: 0.9, valSize: 0.85, bluffSize: 0.85, overbet: 0.2, callMult: 0.75, respect: 0.2, raiseVal: 0.65, raiseFreq: 0.8, bluffRaise: 0.3, slow: 0.02, rangeWidth: 1.6, stick: 1.2 }),
    S('fish', 'Loose-Passive Fish', 'Loose / Passive', 'Limps a lot, calls raises with weak hands, and only bets when it has something real.',
      { open: 0.08, limp: 0.6, limpExtra: 0.35, call: 0.25, threeBet: 0.015, call3: 0.10, fourBet: 0.01, valFreq: 0.55, thinFreq: 0.05, bluff: 0.03, cbet: 0.3, semi: 0.15, callMult: 0.75, respect: 0.25, bluffRaise: 0.01, raiseFreq: 0.5, heroRiver: 0.2, rangeWidth: 1.4, stick: 1.4 }),
    S('scared', 'Scared Money', 'Tight / Passive', 'Folds the moment it faces a big bet or a raise, even with decent hands. Steal its pots.',
      { open: 0.14, call: 0.06, threeBet: 0.02, call3: 0.02, fourBet: 0.012, valFreq: 0.7, thinFreq: 0.05, bluff: 0.01, cbet: 0.5, callMult: 1.35, respect: 1.7, rangeWidth: 0.75, stick: 0.45 }),
    S('trapper', 'Slowplayer', 'Tight / Tricky', 'Checks and calls with monsters, then springs a raise later. A check from it does not mean weakness.',
      { open: 0.18, call: 0.10, threeBet: 0.03, slowPre: 0.35, valFreq: 0.9, slow: 0.7, thinFreq: 0.1, bluff: 0.05, raiseVal: 0.74, raiseFreq: 0.9, checkRaise: 0.6, callMult: 1.0 }),
    S('bluffer', 'Bluff Happy', 'Loose / Aggressive', 'Barrels with nothing. Calling down light beats it, if you can stomach the variance.',
      { open: 0.28, call: 0.12, threeBet: 0.08, bluff3: 0.5, thinBet: 0.45, thinFreq: 0.5, bluff: 0.42, cbet: 0.9, semi: 0.85, valSize: 0.75, bluffSize: 0.8, callMult: 0.9, respect: 0.4, bluffRaise: 0.25, rangeWidth: 1.3, stick: 0.9 }),
    S('shover', 'Short-Stack Shover', 'Push-fold', 'Jams all-in preflop with a wide range and shoves any decent made hand. Simple: hold a hand worth calling.',
      { open: 0.25, openSize: 3, threeBet: 0.07, jam: 1, pushBelow: 35, valueBet: 0.58, valFreq: 0.9, thinFreq: 0.3, bluff: 0.1, valSize: 1.0, bluffSize: 1.0, overbet: 0.5, raiseVal: 0.7, callMult: 0.95 }),
    S('limper', 'Limp-Fest', 'Loose / Passive', 'Limps in with everything, calls raises, and plays small pots. Isolate it with a raise.',
      { open: 0.07, limp: 0.8, limpExtra: 0.4, limpRaiseTop: 0.03, call: 0.24, threeBet: 0.02, call3: 0.10, valFreq: 0.65, thinFreq: 0.08, bluff: 0.03, callMult: 0.8, respect: 0.35, rangeWidth: 1.3, stick: 1.3 }),
    S('threebetter', '3-Bet Machine', 'Tight / Aggressive', 'Rarely just calls: it re-raises light and sticks in 4-bets. Tighten up your calling range against it.',
      { open: 0.25, call: 0.07, threeBet: 0.18, bluff3: 0.6, call3: 0.08, fourBet: 0.06, fiveBet: 0.02, valueBet: 0.62, bluff: 0.12, cbet: 0.75, raiseVal: 0.78, bluffRaise: 0.12, rangeWidth: 1.1 }),
    S('gto', 'Balanced Pro', 'Balanced', 'Mixes value bets and bluffs in sound ratios and defends against bets at the right frequency. Hard to exploit.',
      { open: 0.22, call: 0.10, threeBet: 0.07, bluff3: 0.35, call3: 0.07, fourBet: 0.03, valueBet: 0.64, thinBet: 0.5, thinFreq: 0.4, bluff: 0.16, cbet: 0.62, semi: 0.6, valSize: 0.66, bluffSize: 0.66, sizeVar: 0.05, respect: 0.85, callMult: 1.0, bluffRaise: 0.1, noise: 0.05 }),
    S('draw', 'Draw Chaser', 'Loose / Calling', 'Chases every flush and straight draw, calling big bets for the chance to get there.',
      { open: 0.20, call: 0.17, valFreq: 0.75, thinFreq: 0.1, bluff: 0.04, semi: 0.8, drawLove: 2.2, callMult: 0.95, respect: 0.8, bluffRaise: 0.12, rangeWidth: 1.15 }),
    S('minraiser', 'Min-Raiser', 'Passive / Odd sizing', 'Min-raises preflop and bets tiny. Cheap to play against, but its sizing gives away little.',
      { open: 0.22, openSize: 2, threeSize: 2.2, call: 0.12, valSize: 0.28, bluffSize: 0.25, sizeVar: 0.04, valFreq: 0.9, thinFreq: 0.4, bluff: 0.12, raiseFreq: 0.5, callMult: 0.9 }),
    S('overfolder', 'Fold-to-Pressure', 'Loose pre / Weak post', 'Plays plenty of hands but gives up postflop at the first sign of resistance. Fire second barrels.',
      { open: 0.24, call: 0.12, threeBet: 0.04, valFreq: 0.9, bluff: 0.14, cbet: 0.7, semi: 0.5, callMult: 1.6, respect: 1.9, rangeWidth: 0.9, stick: 0.35 }),
    S('steamer', 'Steamer', 'Tilts after losses', 'A decent player until it loses a big pot, then it opens up, bluffs and calls light. Keep an eye on its mood.',
      { tiltable: 1 }),
    S('cbetter', 'C-Bet Bot', 'Tight / Aggressive', 'Fires a flop continuation bet almost every time and then gives up the turn without a real hand.',
      { cbet: 1.0, giveUpTurn: 1, bluff: 0.03, semi: 0.3, thinFreq: 0.2, callMult: 1.1, rangeWidth: 0.9, stick: 0.8 }),
    S('polarizer', 'Overbetter', 'Polarized', 'Bets either small or huge, often an overbet. Big bets are usually monsters or total bluffs.',
      { open: 0.22, valSize: 1.25, bluffSize: 1.25, overbet: 0.55, thinFreq: 0.15, bluff: 0.22, semi: 0.55, raiseFreq: 0.6, rangeWidth: 1.1, stick: 0.9 }),
    S('hero', 'Hero Caller', 'Loose / Calling', 'Suspicious of every bet and calls down light, especially on the river. Thin value bets work well.',
      { call: 0.18, valFreq: 0.65, thinFreq: 0.1, bluff: 0.03, cbet: 0.4, callMult: 0.62, respect: 0.1, heroRiver: 0.55, raiseFreq: 0.4, rangeWidth: 1.2, stick: 1.5 }),
    S('checkraiser', 'Check-Raiser', 'Tricky / Aggressive', 'Likes to check strong hands and raise when you bet. A bet into its check can walk into a raise.',
      { slow: 0.55, raiseVal: 0.68, raiseFreq: 0.95, checkRaise: 0.9, bluffRaise: 0.12, thinFreq: 0.2, valFreq: 0.85 }),
    S('oldman', 'Coffee-House Nit', 'Very tight / Tricky', 'Plays almost nothing and slowplays what it plays. When it finally raises, run.',
      { open: 0.085, call: 0.04, threeBet: 0.02, call3: 0.02, fourBet: 0.012, slowPre: 0.3, valueBet: 0.74, thinBet: 0.66, valFreq: 0.8, slow: 0.5, thinFreq: 0.03, bluff: 0.01, cbet: 0.4, callMult: 1.3, respect: 1.3, rangeWidth: 0.6, stick: 0.6 }),
    S('tourist', 'Tourist', 'Unpredictable', 'Has no plan. Picks a completely different style every hand, so nothing it does is reliable.',
      { chaos: 1 }),
    S('shark', 'The Shark', 'Adaptive', 'A solid player that studies you: bluffs more if you fold a lot, stops bluffing if you call a lot.',
      { adaptive: 1, open: 0.22, bluff: 0.14, cbet: 0.7, semi: 0.6, thinFreq: 0.4 }),
    S('whale', 'Rich Uncle', 'Very loose / Passive-aggressive', 'Plays almost every hand and splashes chips around. Does not respect your stack, but sometimes has it.',
      { open: 0.45, limp: 0.3, limpExtra: 0.4, call: 0.35, threeBet: 0.07, call3: 0.2, valFreq: 0.85, thinFreq: 0.5, bluff: 0.25, cbet: 0.7, valSize: 0.8, bluffSize: 0.9, callMult: 0.6, respect: 0.05, raiseVal: 0.8, bluffRaise: 0.1, heroRiver: 0.4, rangeWidth: 1.7, stick: 1.6 }),
  ];
  const BY_ID = {}; STYLES.forEach((s) => { BY_ID[s.id] = s; s.params = Object.assign({}, BASE, s.p); });
  const params = (id) => (BY_ID[id] || BY_ID.tag).params;

  const POSMULT = { UTG: 0.55, 'UTG+1': 0.62, MP: 0.7, LJ: 0.78, HJ: 0.88, CO: 1.1, BTN: 1.8, SB: 1.25, BB: 1 };
  function posMult(g, pos) {
    const m = POSMULT[pos] || 1, n = g.n;
    if (n < 6 && (pos === 'BTN' || pos === 'SB' || pos === 'CO' || pos === 'UTG')) return m * (1 + (6 - n) * 0.16);
    return m;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const gauss = (rnd) => (rnd() + rnd() + rnd() - 1.5) / 1.5;

  /* per-game bot state: tilt, chaos picks and opponent stats (for the adaptive style) */
  function createState() { return { tilt: {}, chaos: {}, chaosHand: {}, track: {} }; }
  function afterHand(g, st) {
    const bb = g.bb;
    for (const p of g.players) {
      if (!p.human && p.net <= -8 * bb) st.tilt[p.id] = Math.min(1, (st.tilt[p.id] || 0) + 0.4);
      else if (!p.human && p.net > 0) st.tilt[p.id] = (st.tilt[p.id] || 0) * 0.6;
      else st.tilt[p.id] = (st.tilt[p.id] || 0) * 0.92;
    }
    for (const a of g.actions) {
      if (a.street === 'preflop' || a.toCall <= 0) continue;
      const t = st.track[a.pid] || (st.track[a.pid] = { faced: 0, folded: 0 });
      t.faced++; if (a.type === 'fold') t.folded++;
    }
  }

  function resolve(g, pid, st) {
    const me = g.players[pid]; let P = params(me.style);
    if (P.chaos) {
      if (st.chaosHand[pid] !== g.handNo) { st.chaosHand[pid] = g.handNo; const pool = STYLES.filter((s) => !s.p.chaos && !s.p.adaptive); st.chaos[pid] = pool[Math.floor(g.rnd() * pool.length)].id; }
      P = params(st.chaos[pid]);
    }
    const tilt = P.tiltable ? st.tilt[pid] || 0 : 0;
    if (tilt > 0.05) {
      P = Object.assign({}, P, {
        open: P.open * (1 + tilt * 0.9), threeBet: P.threeBet * (1 + tilt * 1.2), call: P.call * (1 + tilt * 0.9), bluff: P.bluff + tilt * 0.22, cbet: Math.min(1, P.cbet + tilt * 0.25),
        thinFreq: Math.min(1, P.thinFreq + tilt * 0.3), callMult: P.callMult * (1 - tilt * 0.3), respect: P.respect * (1 - tilt * 0.6), semi: Math.min(1, P.semi + tilt * 0.3), valSize: P.valSize + tilt * 0.2, bluffSize: P.bluffSize + tilt * 0.25,
      });
    }
    if (P.adaptive) {
      const opps = g.players.filter((p) => p.id !== pid && !p.folded);
      let sum = 0, cnt = 0;
      for (const o of opps) { const t = st.track[o.id]; if (t && t.faced >= 8) { sum += t.folded / t.faced; cnt++; } }
      const fr = cnt ? sum / cnt : 0.45;
      const m = clamp((fr - 0.33) / 0.15, 0.15, 2.4);
      P = Object.assign({}, P, { bluff: P.bluff * m, cbet: clamp(P.cbet * (0.7 + 0.3 * m), 0.3, 1), semi: clamp(P.semi * (0.6 + 0.4 * m), 0.2, 1), callMult: P.callMult * (fr > 0.55 ? 0.92 : 1) });
    }
    return P;
  }

  /* how often a player who already put in a raise continues against a 4-bet or bigger */
  function cont4(P, raisedAlready) {
    if (!raisedAlready) return { shove: P.fiveBet, call: P.call4 };
    return { shove: Math.max(P.fiveBet, 0.01 + P.threeBet * 0.1), call: Math.max(P.call4, P.fourBet * 1.2, P.threeBet * 0.45) };
  }
  function postflopOrder(g, pid) { return (pid - g.button - 1 + g.n) % g.n; }
  function sizeTo(g, pid, L, target) {
    const me = g.players[pid]; let to = Math.round(target);
    to = clamp(to, L.minRaiseTo, L.maxRaiseTo);
    if (L.maxRaiseTo - to <= 0.55 * to) to = L.maxRaiseTo;
    return { type: 'raise', to };
  }
  const passive = (L) => (L.toCall > 0 ? { type: 'call' } : { type: 'check' });
  const fold = (L) => (L.canCheck ? { type: 'check' } : { type: 'fold' });

  function preflop(g, pid, P, L, rnd) {
    const me = g.players[pid], bb = g.bb, pct = R.pct(me.hole);
    const stackBB = (me.stack + me.bet) / bb, raises = g.preflopRaises;
    const pm = g.n === 2 ? (me.pos === 'BTN' ? 3.2 : 1) : posMult(g, me.pos);
    const tiltM = 1;
    const iOpened = g.actions.some((a) => a.pid === pid && a.street === 'preflop' && a.type === 'raise');
    const raiserOrder = g.lastRaiserPid >= 0 ? postflopOrder(g, g.lastRaiserPid) : -1;
    const ip = raiserOrder >= 0 && postflopOrder(g, pid) > raiserOrder;
    const jitter = 1 + gauss(rnd) * 0.12;

    // push/fold regime
    const pushBB = Math.max(P.pushBelow, 9);
    if (stackBB <= pushBB) {
      const depth = clamp((pushBB - stackBB) / pushBB, 0, 1);
      if (raises === 0) {
        const range = clamp((0.2 + depth * 0.35) * Math.min(pm, 1.8) * (P.jam ? 1.25 : 1) * jitter, 0.05, 0.85);
        if (pct <= range && L.canRaise) return { type: 'raise', to: L.maxRaiseTo };
        if (pct <= range && !L.canRaise) return passive(L);
        if (L.canCheck) return { type: 'check' };
        return fold(L);
      }
      const callRange = clamp(0.07 + depth * 0.14 + (P.call - 0.09) * 0.5, 0.03, 0.4) * jitter * (L.toCall > stackBB * bb * 0.5 ? 0.7 : 1);
      if (pct <= callRange) return L.canRaise && pct <= callRange * 0.4 && raises < 2 ? { type: 'raise', to: L.maxRaiseTo } : passive(L);
      return fold(L);
    }

    if (raises === 0) { // unopened or limped pot
      if (L.canCheck) { // big blind option
        const isoPct = clamp(P.iso * jitter * (1 + g.limpers * 0.2), 0, 0.5);
        if (pct <= isoPct && L.canRaise) return sizeTo(g, pid, L, (P.openSize + g.limpers) * bb * 0.95);
        return { type: 'check' };
      }
      let openPct = clamp(P.open * pm * jitter, 0.02, 0.97);
      if (g.limpers > 0) openPct = clamp(openPct * 0.8, 0.02, 0.9);
      if (pct <= openPct) {
        if (P.limp > 0 && pct > P.limpRaiseTop && rnd() < P.limp) return { type: 'call' };
        if (P.slowPre > 0 && pct <= 0.012 && rnd() < P.slowPre) return { type: 'call' };
        const size = P.jam && stackBB < 45 ? L.maxRaiseTo : (P.openSize + g.limpers) * bb;
        return sizeTo(g, pid, L, size * (1 + gauss(rnd) * 0.08));
      }
      if (P.limp > 0 && pct <= openPct + P.limpExtra && rnd() < P.limp) return { type: 'call' };
      return fold(L);
    }

    const toBB = g.currentBet / bb;
    if (raises === 1) { // facing an open
      const three = clamp(P.threeBet * jitter, 0, 0.5) * (me.pos === 'SB' ? 1.15 : 1);
      if (pct <= three && L.canRaise) {
        const mult = P.threeSize + (ip ? 0 : 0.9) + g.players.filter((p) => !p.folded && p.id !== pid && p.bet > 0 && p.id !== g.lastRaiserPid).length * 0.8;
        const to = P.jam && stackBB < 45 ? L.maxRaiseTo : g.currentBet * mult;
        return sizeTo(g, pid, L, to);
      }
      if (P.slowPre > 0 && pct <= 0.012 && rnd() < P.slowPre) return { type: 'call' };
      if (pct > three && pct <= three * 2.4 && L.canRaise && rnd() < P.bluff3 && pct > 0.08) return sizeTo(g, pid, L, g.currentBet * (P.threeSize + (ip ? 0 : 0.9)));
      let call = P.call * jitter;
      if (me.pos === 'BB') call *= toBB <= 2.6 ? 3.8 : toBB <= 3.6 ? 3.1 : toBB <= 5 ? 2 : 1.1;
      else if (me.pos === 'SB') call *= 0.9;
      else if (me.pos === 'BTN' || me.pos === 'CO' || me.pos === 'HJ') call *= 1.35;
      if (toBB > 9) call *= 0.5; else if (toBB > 6) call *= 0.75;
      if (g.n === 2) call *= 1.8;
      call = clamp(call, 0, 0.75);
      if (pct <= call) return { type: 'call' };
      return fold(L);
    }
    if (raises === 2) { // facing a 3-bet
      let four = P.fourBet * jitter, call3 = P.call3 * jitter;
      if (!iOpened) { four *= 0.5; call3 *= 0.45; }
      if (pct <= four && L.canRaise) return sizeTo(g, pid, L, stackBB < 60 ? L.maxRaiseTo : g.currentBet * (ip ? 2.2 : 2.5));
      if (pct > four && pct <= four * 2.5 && L.canRaise && iOpened && rnd() < P.bluff3 * 0.5 && pct > 0.08) return sizeTo(g, pid, L, g.currentBet * 2.4);
      if (pct <= call3 * (toBB > 18 ? 0.6 : 1)) return { type: 'call' };
      return fold(L);
    }
    // facing a 4-bet or bigger
    const c4 = cont4(P, iOpened);
    if (pct <= c4.shove * jitter && L.canRaise) return { type: 'raise', to: L.maxRaiseTo };
    if (pct <= c4.call * jitter) return passive(L);
    return fold(L);
  }

  function postflop(g, pid, P, L, rnd) {
    const me = g.players[pid], bb = g.bb, pot = g.pot();
    const opps = g.players.filter((p) => p.id !== pid && !p.folded);
    const k = Math.min(opps.length, 3);
    const eq = R.equity(me.hole, g.board, [k].reduce((a) => { for (let i = 0; i < k; i++) a.push(1); return a; }, []), g.street === 'river' ? 200 : 150, rnd);
    const street = g.street, river = street === 'river';
    const dr = river ? { fd: false, oesd: false, gut: false } : R.draws(me.hole, g.board);
    const isDraw = (dr.fd || dr.oesd) && eq < 0.62;
    const wasAggr = g.aggressor === pid;
    const noise = gauss(rnd) * P.noise;
    const e = eq + noise;
    const stackLeft = me.stack;

    if (L.canCheck) { // nobody has bet
      let bet = false, value = false;
      const multi = k > 1 ? 0.55 : 1;
      if (e >= P.valueBet) { value = true; const monster = e >= 0.86; bet = !(monster && rnd() < P.slow) && rnd() < P.valFreq; }
      else if (e >= P.thinBet) { value = true; bet = rnd() < P.thinFreq * (k > 1 ? 0.7 : 1); }
      else {
        let pb = P.bluff * multi;
        if (street === 'flop' && wasAggr && g.streetRaises === 0) pb = Math.max(pb, P.cbet * (k > 1 ? 0.5 : 1));
        if (street === 'turn' && wasAggr && P.cbet > 0.75 && !P.giveUpTurn) pb = Math.max(pb, 0.5 * multi);
        if (P.giveUpTurn && street !== 'flop') pb = 0.04;
        if (isDraw && !river) pb = Math.max(pb, P.semi * multi);
        if (river && P.bluff < 0.1) pb *= 0.6;
        bet = rnd() < pb;
      }
      if (!bet || !L.canRaise) return { type: 'check' };
      let f = value ? P.valSize : P.bluffSize;
      if (P.overbet > 0 && rnd() < P.overbet) f = 1.1 + rnd() * 0.5;
      else if (P.overbet > 0 && rnd() < 0.4) f = 0.33;
      f = Math.max(0.2, f * (1 + gauss(rnd) * P.sizeVar));
      if (!value && !river) f *= 0.95;
      return sizeTo(g, pid, L, Math.max(bb, Math.round(pot * f)));
    }

    // facing a bet
    const toCall = L.toCall;
    const req = toCall / (pot + toCall);
    const betFrac = toCall / Math.max(1, pot - toCall);
    let eff = e - P.respect * 0.17 * Math.min(betFrac, 1.7) - (g.streetRaises > 1 ? 0.08 * P.respect : 0);
    if (isDraw) eff += P.drawLove * 0.07;
    if (river && P.heroRiver > 0 && betFrac < 1.2) eff += P.heroRiver * 0.12;
    const bigRaise = L.canRaise && stackLeft > toCall;
    if (bigRaise && eff >= P.raiseVal && rnd() < P.raiseFreq && !(street === 'flop' && P.checkRaise === 0 && rnd() < P.slow * 0.5)) {
      const rf = 0.65 + rnd() * 0.45;
      return sizeTo(g, pid, L, g.currentBet + Math.max(g.lastRaise, Math.round((pot + toCall) * rf)));
    }
    if (bigRaise && !river && rnd() < P.bluffRaise * (eq < 0.5 ? 1 : 0.2) * (isDraw ? 2 : 1) && g.streetRaises < 2) {
      return sizeTo(g, pid, L, g.currentBet + Math.max(g.lastRaise, Math.round((pot + toCall) * 0.8)));
    }
    if (P.checkRaise > 0 && bigRaise && eff >= P.raiseVal - 0.05 && rnd() < P.checkRaise * 0.5) return sizeTo(g, pid, L, g.currentBet + Math.max(g.lastRaise, Math.round((pot + toCall) * 0.8)));
    if (eff >= req * P.callMult + 0.02) return { type: 'call' };
    return { type: 'fold' };
  }

  function decide(g, pid, st, rnd) {
    rnd = rnd || g.rnd || Math.random;
    const L = g.legal(pid), P = resolve(g, pid, st || createState());
    let a = g.street === 'preflop' ? preflop(g, pid, P, L, rnd) : postflop(g, pid, P, L, rnd);
    if (a.type === 'raise' && !L.canRaise) a = L.toCall > 0 ? { type: 'call' } : { type: 'check' };
    if (a.type === 'fold' && L.canCheck) a = { type: 'check' };
    if (a.type === 'check' && !L.canCheck) a = { type: 'call' };
    if (a.type === 'raise') a.to = clamp(Math.round(a.to), L.minRaiseTo, L.maxRaiseTo);
    return a;
  }

  PK.Bots = { STYLES, BY_ID, params, decide, createState, afterHand, BASE, POSMULT, posMult, postflopOrder, cont4 };
  if (typeof module !== 'undefined') module.exports = PK.Bots;
})();
