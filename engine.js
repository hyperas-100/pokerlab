/* PokerLab engine: cards, 7-card evaluator, No-Limit Hold'em game state machine.
   Pure JS, runs in the browser and in Node. */
(function () {
  const PK = (globalThis.PK = globalThis.PK || {});
  const RANKS = '23456789TJQKA', SUITS = 'cdhs';
  const cardStr = (c) => RANKS[c >> 2] + SUITS[c & 3];
  const parseCard = (s) => RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]);

  /* ---------- evaluator ---------- */
  const rc = new Int8Array(13), sm = new Int32Array(4), sc = new Int8Array(4);
  function straightHigh(m) {
    for (let hi = 12; hi >= 4; hi--) { const need = 0x1f << (hi - 4); if ((m & need) === need) return hi; }
    if ((m & 0x100f) === 0x100f) return 3;
    return -1;
  }
  function topK(m, k) { const r = []; for (let i = 12; i >= 0 && r.length < k; i--) if ((m >> i) & 1) r.push(i); return r; }
  function pack(cat, a) { let s = cat << 20; for (let i = 0; i < 5 && i < a.length; i++) s |= a[i] << (16 - 4 * i); return s; }
  /* cards: array of ints (rank*4+suit), 5 to 7 cards. Higher score = better hand. */
  function eval7(c) {
    rc.fill(0); sm.fill(0); sc.fill(0);
    for (let i = 0; i < c.length; i++) { const r = c[i] >> 2, s = c[i] & 3; rc[r]++; sm[s] |= 1 << r; sc[s]++; }
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) {
      const m = sm[s], sf = straightHigh(m);
      if (sf >= 0) return pack(8, [sf]);
      return pack(5, topK(m, 5));
    }
    let all = 0, quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = rc[r]; if (!n) continue;
      all |= 1 << r;
      if (n === 4) quad = r;
      else if (n === 3) { if (t1 < 0) t1 = r; else t2 = r; }
      else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    if (quad >= 0) return pack(7, [quad, topK(all & ~(1 << quad), 1)[0]]);
    if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return pack(6, [t1, Math.max(t2, p1)]);
    const sh = straightHigh(all);
    if (sh >= 0) return pack(4, [sh]);
    if (t1 >= 0) return pack(3, [t1].concat(topK(all & ~(1 << t1), 2)));
    if (p1 >= 0 && p2 >= 0) return pack(2, [p1, p2, topK(all & ~(1 << p1) & ~(1 << p2), 1)[0]]);
    if (p1 >= 0) return pack(1, [p1].concat(topK(all & ~(1 << p1), 3)));
    return pack(0, topK(all, 5));
  }
  const CAT = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const RN = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
  const R1 = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
  function handName(s) {
    const cat = s >> 20, k = [0, 1, 2, 3, 4].map((i) => (s >> (16 - 4 * i)) & 15);
    switch (cat) {
      case 0: return R1[k[0]] + ' high';
      case 1: return 'Pair of ' + RN[k[0]];
      case 2: return 'Two pair, ' + RN[k[0]] + ' and ' + RN[k[1]];
      case 3: return 'Three ' + RN[k[0]];
      case 4: return R1[k[0]] + '-high straight';
      case 5: return R1[k[0]] + '-high flush';
      case 6: return 'Full house, ' + RN[k[0]] + ' over ' + RN[k[1]];
      case 7: return 'Four ' + RN[k[0]];
      default: return k[0] === 12 ? 'Royal flush' : R1[k[0]] + '-high straight flush';
    }
  }

  function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function mulberry32(seed) { let a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- game ---------- */
  const POS_NAMES = { 1: ['CO'], 2: ['UTG', 'CO'], 3: ['UTG', 'HJ', 'CO'], 4: ['UTG', 'MP', 'HJ', 'CO'], 5: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'], 6: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'] };
  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  class Game {
    /* cfg: { seats:[{name, style, human}], sb, bb, startStack, stackMode:'carry'|'reset', rnd } */
    constructor(cfg) {
      this.rnd = cfg.rnd || Math.random;
      this.sb = cfg.sb; this.bb = cfg.bb; this.startStack = cfg.startStack;
      this.stackMode = cfg.stackMode || 'carry';
      this.rotate = cfg.rotate !== false;
      this.players = cfg.seats.map((s, i) => ({
        id: i, name: s.name, style: s.style || null, human: !!s.human,
        stack: cfg.startStack, bet: 0, total: 0, folded: false, allIn: false, acted: false, raiseLocked: false,
        hole: [], pos: '', rebuys: 0, handStart: cfg.startStack, net: 0,
      }));
      this.n = this.players.length;
      this.button = Math.floor(this.rnd() * this.n);
      this.handNo = 0; this.phase = 'idle'; this.board = []; this.street = 'preflop';
      this.actions = []; this.log = []; this.result = null; this.toAct = -1;
    }
    pot() { let s = 0; for (const p of this.players) s += p.total; return s; }
    streetPot() { return this.pot(); }
    activeCount() { return this.players.filter((p) => !p.folded).length; }
    sbIdx() { return this.n === 2 ? this.button : (this.button + 1) % this.n; }
    bbIdx() { return this.n === 2 ? (this.button + 1) % 2 : (this.button + 2) % this.n; }

    startHand() {
      this.handNo++; this.phase = 'betting'; this.board = []; this.street = 'preflop'; this.result = null;
      this.actions = []; this.log = []; this.reviewable = true;
      if (this.rotate) this.button = (this.button + 1) % this.n;
      for (const p of this.players) {
        if (this.stackMode === 'reset' || p.stack <= 0) { if (p.stack <= 0 && this.stackMode !== 'reset') p.rebuys++; p.stack = this.startStack; }
        p.handStart = p.stack; p.bet = 0; p.total = 0; p.folded = false; p.allIn = false; p.acted = false; p.raiseLocked = false; p.hole = []; p.net = 0; p.shown = false;
      }
      this._positions();
      this.deck = shuffle(Array.from({ length: 52 }, (_, i) => i), this.rnd);
      for (let r = 0; r < 2; r++) for (let k = 1; k <= this.n; k++) this.players[(this.button + k) % this.n].hole.push(this.deck.pop());
      this.currentBet = 0; this.lastRaise = this.bb; this.preflopRaises = 0; this.aggressor = -1; this.limpers = 0; this.streetRaises = 0; this.lastRaiserPid = -1;
      this._post(this.players[this.sbIdx()], this.sb, 'small blind');
      this._post(this.players[this.bbIdx()], this.bb, 'big blind');
      this.currentBet = Math.max(this.players[this.sbIdx()].bet, this.players[this.bbIdx()].bet);
      this.toAct = this._nextActor(this.n === 2 ? this.button : (this.bbIdx() + 1) % this.n);
      if (this.toAct < 0 || this._roundDone()) this._nextStreet();
      return this;
    }
    _positions() {
      const n = this.n, b = this.button;
      for (const p of this.players) p.pos = '';
      this.players[b].pos = 'BTN';
      if (n === 2) { this.players[(b + 1) % 2].pos = 'BB'; return; }
      this.players[(b + 1) % n].pos = 'SB'; this.players[(b + 2) % n].pos = 'BB';
      const mid = POS_NAMES[n - 3];
      if (mid) for (let i = 0; i < mid.length; i++) this.players[(b + 3 + i) % n].pos = mid[i];
    }
    _post(p, amt, label) {
      const a = Math.min(amt, p.stack); p.stack -= a; p.bet += a; p.total += a; if (p.stack === 0) p.allIn = true;
      this.log.push({ t: 'post', pid: p.id, amount: a, label, street: 'preflop' });
    }
    _nextActor(from) {
      for (let k = 0; k < this.n; k++) {
        const i = (from + k) % this.n, p = this.players[i];
        if (!p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet)) return i;
      }
      return -1;
    }
    _roundDone() {
      const can = this.players.filter((p) => !p.folded && !p.allIn);
      if (can.length === 0) return true;
      if (can.length === 1) return can[0].bet >= this.currentBet;
      return can.every((p) => p.acted && p.bet === this.currentBet);
    }
    legal(pid) {
      const p = this.players[pid];
      const toCall = Math.min(this.currentBet - p.bet, p.stack);
      const maxTo = p.bet + p.stack;
      const othersCanCall = this.players.some((q) => q.id !== pid && !q.folded && !q.allIn);
      const canRaise = !p.raiseLocked && p.stack > toCall && othersCanCall;
      const minTo = Math.min(maxTo, this.currentBet + this.lastRaise);
      return { toCall, canCheck: this.currentBet === p.bet, canRaise, minRaiseTo: minTo, maxRaiseTo: maxTo, stack: p.stack, bet: p.bet };
    }
    /* a: {type:'fold'|'check'|'call'|'raise', to?} */
    act(pid, a) {
      if (this.phase !== 'betting' || pid !== this.toAct) throw new Error('not your turn');
      const p = this.players[pid], L = this.legal(pid);
      const snap = { pid, street: this.street, board: this.board.slice(), potBefore: this.pot(), toCall: L.toCall, stackBefore: p.stack, betBefore: p.bet, currentBet: this.currentBet, hole: p.hole.slice(), pos: p.pos, preflopRaises: this.preflopRaises, limpers: this.limpers, n: this.activeCount(), lastRaise: this.lastRaise, minTo: L.minRaiseTo, maxTo: L.maxRaiseTo, canRaise: L.canRaise, canCheck: L.canCheck };
      let type = a.type, add = 0, to = p.bet;
      if (type === 'check' && !L.canCheck) throw new Error('cannot check');
      if (type === 'fold') { p.folded = true; }
      else if (type === 'check') { /* nothing */ }
      else if (type === 'call') {
        if (L.toCall <= 0) { type = 'check'; }
        else {
          add = L.toCall; p.stack -= add; p.bet += add; p.total += add; to = p.bet;
          if (p.stack === 0) p.allIn = true;
          if (this.street === 'preflop' && this.preflopRaises === 0 && !(p.pos === 'BB')) this.limpers++;
        }
      } else if (type === 'raise') {
        let X = Math.floor(a.to);
        if (!L.canRaise) throw new Error('cannot raise');
        if (X > L.maxRaiseTo) X = L.maxRaiseTo;
        if (X < L.minRaiseTo && X < L.maxRaiseTo) throw new Error('raise too small');
        add = X - p.bet; p.stack -= add; p.bet = X; p.total += add; to = X;
        if (p.stack === 0) p.allIn = true;
        const size = X - this.currentBet;
        snap.wasBet = this.currentBet === 0;
        if (size >= this.lastRaise) {
          this.lastRaise = size;
          for (const q of this.players) if (q.id !== pid) { q.acted = false; q.raiseLocked = false; }
          this.lastRaiserPid = pid;
        } else {
          for (const q of this.players) if (q.id !== pid && q.acted) q.raiseLocked = true;
        }
        this.currentBet = X; this.streetRaises++;
        if (this.street === 'preflop') { this.preflopRaises++; this.aggressor = pid; }
      } else throw new Error('bad action');
      p.acted = true;
      snap.type = type; snap.to = to; snap.add = add; snap.allIn = p.allIn; snap.potAfter = this.pot();
      this.actions.push(snap);
      this.log.push({ t: type, pid, to, amount: add, street: this.street, allIn: p.allIn, bet: !!snap.wasBet });
      this._advance();
      return snap;
    }
    _advance() {
      if (this.activeCount() === 1) return this._award(true);
      if (this._roundDone()) return this._nextStreet();
      this.toAct = this._nextActor((this.toAct + 1) % this.n);
      if (this.toAct < 0) this._nextStreet();
    }
    _deal(street) {
      const k = street === 'flop' ? 3 : 1;
      for (let i = 0; i < k; i++) this.board.push(this.deck.pop());
      this.street = street;
      this.log.push({ t: 'deal', street, cards: this.board.slice(-k) });
    }
    _nextStreet() {
      for (const p of this.players) { p.bet = 0; p.acted = false; p.raiseLocked = false; }
      this.currentBet = 0; this.lastRaise = this.bb; this.streetRaises = 0;
      if (this.street === 'river') return this._award(false);
      this._deal(STREETS[STREETS.indexOf(this.street) + 1]);
      const can = this.players.filter((p) => !p.folded && !p.allIn);
      if (can.length <= 1) {
        while (this.street !== 'river') this._deal(STREETS[STREETS.indexOf(this.street) + 1]);
        return this._award(false);
      }
      this.toAct = this._nextActor((this.button + 1) % this.n);
    }
    _award(uncontested) {
      const alive = this.players.filter((p) => !p.folded);
      const hands = {}; const pots = [];
      if (uncontested) {
        const w = alive[0], amt = this.pot();
        w.stack += amt; pots.push({ amount: amt, winners: [w.id], eligible: [w.id] });
      } else {
        for (const p of alive) { const s = eval7(p.hole.concat(this.board)); hands[p.id] = { score: s, name: handName(s) }; p.shown = true; }
        const levels = [...new Set(this.players.filter((p) => p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
        let prev = 0, carry = 0;
        for (const lv of levels) {
          let amt = carry; for (const p of this.players) amt += Math.min(p.total, lv) - Math.min(p.total, prev);
          const elig = alive.filter((p) => p.total >= lv);
          prev = lv;
          if (!elig.length) { carry = amt; continue; }
          carry = 0;
          let best = -1; for (const p of elig) best = Math.max(best, hands[p.id].score);
          const ws = elig.filter((p) => hands[p.id].score === best);
          const share = Math.floor(amt / ws.length); let rem = amt - share * ws.length;
          const order = ws.slice().sort((a, b) => ((a.id - this.button + this.n - 1) % this.n) - ((b.id - this.button + this.n - 1) % this.n));
          for (const w of order) { w.stack += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
          pots.push({ amount: amt, winners: ws.map((p) => p.id), eligible: elig.map((p) => p.id) });
        }
      }
      for (const p of this.players) p.net = p.stack - p.handStart;
      this.result = { uncontested, pots, hands, nets: this.players.map((p) => p.net), board: this.board.slice() };
      this.phase = 'over'; this.toAct = -1;
      this.log.push({ t: 'result' });
    }
    totalChips() { return this.players.reduce((s, p) => s + p.stack, 0); }
  }

  PK.Engine = { Game, eval7, handName, cardStr, parseCard, shuffle, mulberry32, RANKS, SUITS, CAT, STREETS, POS_NAMES };
  if (typeof module !== 'undefined') module.exports = PK.Engine;
})();
