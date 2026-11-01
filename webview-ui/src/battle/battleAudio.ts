/**
 * Battle soundscape, synthesized with the Web Audio API (no audio files):
 * bugle and horn calls, fife-and-drum band, marching drums, sword clangs,
 * musketry and gunfire, bow twangs with arrows whistling overhead, catapults,
 * cannon, galloping cavalry and crackling fires.
 *
 * The engine raises discrete cues (calls, volleys, impacts) in
 * `BattleState.cues`; continuous sounds (melee, hooves, drums, fire) are read
 * off the state every frame. Each recipe below is its own small instrument —
 * the numbers in them are the timbre, the way pixel art is the sprite.
 */
import {
  BATTLE_CALL_COOLDOWN_SEC,
  BATTLE_CLASH_MAX_PER_SEC,
  BATTLE_CLASH_RATE_PER_PAIR,
  BATTLE_CRACKLE_MAX_PER_SEC,
  BATTLE_CRACKLE_RATE_PER_FIRE,
  BATTLE_DRUM_INTERVAL_SEC,
  BATTLE_GALLOP_INTERVAL_SEC,
  BATTLE_MASTER_VOLUME,
  BATTLE_MUTED_STORAGE_KEY,
  BATTLE_PROJECTILE_FLIGHT_SEC,
  BATTLE_SHOT_SOUNDS_PER_SEC,
} from '../constants.js';
import type { Cue, Weapon } from './battleEffects.js';
import { meleeSoundFor } from './battleEffects.js';
import type { BattleState } from './battleEngine.js';
import type { SideId, UnitType } from './battleTypes.js';

const MOUNTED: ReadonlySet<UnitType> = new Set([
  'cavalry',
  'heavy_cavalry',
  'horse_archers',
  'chariots',
  'elephants',
]);
const FOOT: ReadonlySet<UnitType> = new Set([
  'infantry',
  'heavy_infantry',
  'light_infantry',
  'archers',
]);

/** Natural bugle harmonics on C (no valves on a field bugle). */
const BUGLE = { G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

type Note = [freq: number, dur: number];
const CHARGE_CALL: Note[] = [
  [BUGLE.G4, 0.13],
  [BUGLE.C5, 0.13],
  [BUGLE.E5, 0.13],
  [BUGLE.G5, 0.26],
  [BUGLE.E5, 0.13],
  [BUGLE.G5, 0.7],
];
const RETREAT_CALL: Note[] = [
  [BUGLE.G5, 0.34],
  [BUGLE.E5, 0.34],
  [BUGLE.C5, 0.34],
  [BUGLE.G4, 0.9],
];
/** Bronze horns (salpinx, cornu, carnyx) blew long, low blasts. */
const HORN_ATTACK: Note[] = [
  [130.8, 0.45],
  [196, 0.45],
  [261.6, 1.1],
];
const HORN_RETREAT: Note[] = [
  [261.6, 0.7],
  [196, 0.7],
  [130.8, 1.3],
];
/** A fife tune in D for the band (8th notes, then a held note). */
const FIFE_TUNE: Note[] = [
  [587.3, 0.25],
  [740, 0.25],
  [880, 0.25],
  [740, 0.25],
  [784, 0.25],
  [880, 0.25],
  [987.8, 0.5],
  [880, 0.25],
  [784, 0.25],
  [740, 0.25],
  [659.3, 0.25],
  [587.3, 1.0],
];

export class BattleAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private fireBed: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private muted = readMuted();
  private lastCall = new Map<string, number>();
  private shotTokens = BATTLE_SHOT_SOUNDS_PER_SEC;
  private gallopTimer = 0;
  private drumTimer = 0;
  private drumBeat = 0;
  private clashAcc = 0;
  private crackleAcc = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(BATTLE_MUTED_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable: the toggle still works for this session */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : BATTLE_MASTER_VOLUME,
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  /** Create/resume the context. Call from a user gesture (Simulate, Send). */
  unlock(): void {
    try {
      if (!this.ctx) this.build();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null; // no Web Audio: the battle simply stays silent
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.fireBed = null;
  }

  private build(): void {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : BATTLE_MASTER_VOLUME;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);

    // Open-field reverb: a short decaying-noise impulse, mixed in quietly.
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 1.6, 2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    reverb.connect(wet).connect(master);
    const dry = ctx.createGain();
    dry.connect(master);
    dry.connect(reverb);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx;
    this.master = master;
    this.dry = dry;
    this.noise = noise;
  }

  /** Per frame: play queued cues and keep the ambient sounds going. */
  update(state: BattleState, dt: number, playing: boolean): void {
    const cues = state.cues.splice(0);
    const ctx = this.ctx;
    if (!ctx || !this.dry || this.muted || !playing || ctx.state !== 'running') {
      this.setFireBed(0);
      return;
    }
    const cols = state.scenario.map.cols;
    const pan = (x: number) =>
      Math.max(-0.8, Math.min(0.8, (x / Math.max(cols - 1, 1)) * 1.6 - 0.8));
    this.shotTokens = Math.min(
      BATTLE_SHOT_SOUNDS_PER_SEC,
      this.shotTokens + BATTLE_SHOT_SOUNDS_PER_SEC * dt,
    );

    for (const cue of cues) this.playCue(state, cue, pan);

    // Melee: random clashes, more pairs → denser, capped.
    const pairs = engagedPairs(state);
    if (pairs.length) {
      this.clashAcc +=
        Math.min(BATTLE_CLASH_MAX_PER_SEC, pairs.length * BATTLE_CLASH_RATE_PER_PAIR) * dt;
      const kind = meleeSoundFor(state.year);
      while (this.clashAcc >= 1) {
        this.clashAcc -= 1;
        const x = pairs[Math.floor(Math.random() * pairs.length)];
        const t = ctx.currentTime + Math.random() * 0.05;
        if (kind === 'swords') this.clang(t, pan(x));
        else if (kind === 'muskets') {
          if (Math.random() < 0.6) this.musketRipple(t, pan(x), 4);
          else this.clang(t, pan(x), 0.5);
        } else this.machineGun(t, pan(x));
      }
    } else this.clashAcc = 0;

    // Cavalry on the move: gallop.
    const riders = state.units.filter(
      (u) => u.visible && u.moving && MOUNTED.has(u.type) && u.status !== 'destroyed',
    );
    this.gallopTimer -= dt;
    if (riders.length && this.gallopTimer <= 0) {
      this.gallopTimer = BATTLE_GALLOP_INTERVAL_SEC * (0.85 + Math.random() * 0.3);
      const x = riders[Math.floor(Math.random() * riders.length)].x;
      this.gallop(ctx.currentTime, pan(x), Math.min(1, 0.45 + riders.length * 0.12));
    }

    // Infantry on the march: the drummers keep step.
    const marching = state.units.filter(
      (u) => u.visible && u.moving && u.status === 'active' && FOOT.has(u.type),
    );
    this.drumTimer -= dt;
    if (marching.length && this.drumTimer <= 0) {
      this.drumTimer = BATTLE_DRUM_INTERVAL_SEC;
      const accent = this.drumBeat++ % 4 === 0;
      this.marchDrum(ctx.currentTime, accent, Math.min(0.55, 0.2 + marching.length * 0.05));
    }

    // Fires: crackles plus a low roar that grows with the blaze.
    const fires = state.fires.length;
    this.setFireBed(Math.min(0.12, fires * 0.006));
    if (fires) {
      this.crackleAcc +=
        Math.min(BATTLE_CRACKLE_MAX_PER_SEC, fires * BATTLE_CRACKLE_RATE_PER_FIRE) * dt;
      while (this.crackleAcc >= 1) {
        this.crackleAcc -= 1;
        const f = state.fires[Math.floor(Math.random() * fires)];
        this.crackle(ctx.currentTime + Math.random() * 0.1, pan(f.x));
      }
    }
  }

  /** The band strikes up as the armies deploy. */
  playBand(year: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.05;
    const ancient = year < 1000;
    // Drums: bass on the beat, snare drags in between, 2 bars at 120 bpm.
    for (let beat = 0; beat < 8; beat++) {
      const t = t0 + beat * 0.5;
      this.bassDrum(t, beat % 4 === 0 ? 0.7 : 0.45);
      if (!ancient) {
        this.snare(t + 0.25, 0.25);
        if (beat % 2 === 1) this.snare(t + 0.375, 0.18);
      } else {
        this.frameDrum(t + 0.25, 0.3);
      }
    }
    // Melody: a fife (or, for antiquity, a reedy double pipe like the aulos).
    let t = t0;
    for (const [f, d] of FIFE_TUNE) {
      this.reed(t, ancient ? f / 2 : f, d, ancient);
      t += d;
    }
  }

  private playCue(state: BattleState, cue: Cue, pan: (x: number) => number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    switch (cue.kind) {
      case 'call': {
        const key = `${cue.side}:${cue.call}`;
        if (now - (this.lastCall.get(key) ?? -99) < BATTLE_CALL_COOLDOWN_SEC) return;
        this.lastCall.set(key, now);
        const ancient = state.year < 1000;
        const tune =
          cue.call === 'attack'
            ? ancient
              ? HORN_ATTACK
              : CHARGE_CALL
            : ancient
              ? HORN_RETREAT
              : RETREAT_CALL;
        this.brass(now + 0.02, tune, sidePan(state, cue.side), ancient);
        return;
      }
      case 'shot': {
        if (this.shotTokens < 1) return;
        this.shotTokens -= 1;
        this.shot(now, cue.weapon, pan(cue.x));
        return;
      }
      case 'impact':
        if (cue.weapon === 'cannon') this.explosion(now, pan(cue.x), 0.8);
        else this.thud(now, pan(cue.x), 0.7);
        return;
    }
  }

  private shot(t: number, weapon: Weapon, p: number): void {
    switch (weapon) {
      case 'bow':
        this.twang(t, p);
        this.whoosh(t + 0.03, p, BATTLE_PROJECTILE_FLIGHT_SEC, 900, 2600, 0.22);
        this.thud(t + BATTLE_PROJECTILE_FLIGHT_SEC, p, 0.12);
        return;
      case 'javelin':
        this.whoosh(t, p, BATTLE_PROJECTILE_FLIGHT_SEC, 500, 1400, 0.25);
        this.thud(t + BATTLE_PROJECTILE_FLIGHT_SEC, p, 0.18);
        return;
      case 'catapult':
        this.creak(t, p);
        this.whoosh(t + 0.15, p, BATTLE_PROJECTILE_FLIGHT_SEC, 200, 600, 0.3);
        return;
      case 'cannon':
        this.boom(t, p, 0.9);
        return;
      case 'musket':
        this.musketRipple(t, p, 6);
        return;
      case 'rifle':
        this.crack(t, p, 0.5);
        this.crack(t + 0.09 + Math.random() * 0.1, p, 0.4);
        return;
    }
  }

  // ── Instruments ────────────────────────────────────────────

  private out(p: number): AudioNode {
    const ctx = this.ctx!;
    const panner = ctx.createStereoPanner();
    panner.pan.value = p;
    panner.connect(this.dry!);
    return panner;
  }

  private noiseSource(t: number, dur: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  /** Bugle (or bronze horn): bright saw + square through an opening low-pass, with lip vibrato. */
  private brass(t0: number, tune: Note[], p: number, horn: boolean): void {
    const ctx = this.ctx!;
    const dest = this.out(p);
    let t = t0;
    for (const [freq, dur] of tune) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(horn ? 0.3 : 0.24, t + 0.03);
      g.gain.setValueAtTime(horn ? 0.27 : 0.2, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(horn ? 500 : 900, t);
      lp.frequency.linearRampToValueAtTime(horn ? 1300 : 3200, t + 0.06);
      lp.Q.value = 2;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibDepth = ctx.createGain();
      vibDepth.gain.value = freq * 0.006;
      vib.connect(vibDepth);
      for (const [type, detune] of [
        ['sawtooth', 0],
        ['square', 6],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq * 0.97, t);
        o.frequency.linearRampToValueAtTime(freq, t + 0.04); // lip up to pitch
        o.detune.value = detune;
        vibDepth.connect(o.frequency);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
      vib.start(t);
      vib.stop(t + dur + 0.02);
      lp.connect(g).connect(dest);
      t += dur;
    }
  }

  /** Fife (square + vibrato) or, for antiquity, a buzzy double reed. */
  private reed(t: number, freq: number, dur: number, aulos: boolean): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = aulos ? 'sawtooth' : 'square';
    o.frequency.value = freq;
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vd = ctx.createGain();
    vd.gain.value = freq * 0.008;
    vib.connect(vd).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = aulos ? 1800 : 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.setValueAtTime(0.06, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(this.out(0));
    o.start(t);
    o.stop(t + dur + 0.02);
    vib.start(t);
    vib.stop(t + dur + 0.02);
  }

  private bassDrum(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.out(0));
    o.start(t);
    o.stop(t + 0.45);
  }

  private snare(t: number, vol: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(bp).connect(g).connect(this.out(0));
    const body = ctx.createOscillator();
    body.frequency.value = 190;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(vol * 0.6, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    body.connect(bg).connect(this.out(0));
    body.start(t);
    body.stop(t + 0.1);
  }

  private frameDrum(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.out(0));
    o.start(t);
    o.stop(t + 0.22);
  }

  /** One step of the marching drum: accented bass on the downbeat, snare tap otherwise. */
  private marchDrum(t: number, accent: boolean, vol: number): void {
    if (accent) this.bassDrum(t, vol);
    else this.snare(t, vol * 0.35);
  }

  /** Steel on steel: inharmonic partials ringing out over a scrape of noise. */
  private clang(t: number, p: number, vol = 0.35): void {
    const ctx = this.ctx!;
    const dest = this.out(p);
    const base = 1700 + Math.random() * 900;
    for (const ratio of [1, 1.47, 2.09, 2.76, 3.88]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol / ratio, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.25 + Math.random() * 0.2);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + 0.5);
    }
    const src = this.noiseSource(t, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp).connect(ng).connect(dest);
  }

  /** Bowstring release: a short plucked low note. */
  private twang(t: number, p: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.out(p));
    o.start(t);
    o.stop(t + 0.18);
  }

  /** Something flying past: band-passed noise sweeping in pitch. */
  private whoosh(t: number, p: number, dur: number, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(f0, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(this.out(p));
  }

  /** A dull hit: arrows landing, stones striking earth. */
  private thud(t: number, p: number, vol: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, 0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(lp).connect(g).connect(this.out(p));
  }

  /** Torsion arm winding and releasing. */
  private creak(t: number, p: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(55, t + 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(lp).connect(g).connect(this.out(p));
    o.start(t);
    o.stop(t + 0.32);
    this.thud(t + 0.25, p, 0.35);
  }

  /** Cannon: a falling sub-bass thump under a burst of filtered noise. */
  private boom(t: number, p: number, vol: number): void {
    const ctx = this.ctx!;
    const dest = this.out(p);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 1.25);
    const src = this.noiseSource(t, 0.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(lp).connect(ng).connect(dest);
  }

  /** A shell bursting: crunchier and shorter than the gun itself. */
  private explosion(t: number, p: number, vol: number): void {
    this.boom(t, p, vol * 0.7);
    const ctx = this.ctx!;
    const src = this.noiseSource(t, 0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(bp).connect(g).connect(this.out(p));
  }

  /** One gunshot crack: sharp high transient plus a short body. */
  private crack(t: number, p: number, vol: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, 0.2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(hp).connect(g).connect(this.out(p));
  }

  /** A ragged musket volley: several cracks spread over a fraction of a second. */
  private musketRipple(t: number, p: number, shots: number): void {
    for (let i = 0; i < shots; i++) {
      this.crack(
        t + Math.random() * 0.35,
        p + (Math.random() - 0.5) * 0.2,
        0.22 + Math.random() * 0.15,
      );
    }
  }

  /** A machine-gun burst. */
  private machineGun(t: number, p: number): void {
    const n = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) this.crack(t + i * 0.075, p, 0.25);
  }

  /** Hooves: a three-beat gallop of low thumps. */
  private gallop(t: number, p: number, vol: number): void {
    const ctx = this.ctx!;
    for (const [dt, v] of [
      [0, 0.8],
      [0.09, 0.6],
      [0.19, 1],
    ] as const) {
      const src = this.noiseSource(t + dt, 0.07);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * v * 0.5, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.07);
      src.connect(lp).connect(g).connect(this.out(p));
    }
  }

  /** One crackle of burning wood. */
  private crackle(t: number, p: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500 + Math.random() * 2500;
    const g = ctx.createGain();
    const v = 0.05 + Math.random() * 0.12;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.01 + Math.random() * 0.025);
    src.connect(hp).connect(g).connect(this.out(p));
  }

  /** The steady roar under the crackles, scaled to how much is burning. */
  private setFireBed(level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.fireBed && level > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 280;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(this.dry!);
      src.start();
      this.fireBed = { gain, src };
    }
    this.fireBed?.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.3);
  }
}

/** Unique melee pairs, as the column each fight happens at. */
function engagedPairs(state: BattleState): number[] {
  const xs: number[] = [];
  for (const u of state.units) {
    if (!u.visible || u.status !== 'active' || !u.engagedWith) continue;
    const e = state.byId.get(u.engagedWith);
    if (!e || (e.engagedWith === u.id && u.id > e.id)) continue;
    xs.push((u.x + e.x) / 2);
  }
  return xs;
}

/** Each side's calls come from behind its own lines. */
function sidePan(state: BattleState, side: SideId): number {
  switch (state.homeEdge[side]) {
    case 'left':
      return -0.5;
    case 'right':
      return 0.5;
    default:
      return side === 'A' ? -0.25 : 0.25;
  }
}

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(BATTLE_MUTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
