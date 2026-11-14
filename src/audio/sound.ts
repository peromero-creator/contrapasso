// Original, quiet effects generated locally. Audio never reads or changes the simulation.
import { techniqueId, familyOf } from "../sim/techniques.ts";
import { isSpell, abilityDuration } from "../sim/abilities.ts";
import type { SimEvent } from "../sim/world";

/** Short narrator lines; each speaks a banner or result title the game already shows. */
export const VOICE_LINES = [
  "limbo", "lust", "gluttony", "greed", "wrath",
  "warden", "wizard", "witness", "cantor", "deepens",
  "duel", "won", "dead", "duel-won", "duel-lost",
] as const;
export type VoiceLine = (typeof VOICE_LINES)[number];
/** The narrator sits just above an effect's peak, well under the limiter. */
const VOICE_GAIN = 1.4;

export class Sound {
  muted = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private paused = false;
  private volume = 1;
  private skillChain=0;
  private skillUntil=0;
  private pulseAt = new Map<string, number>();
  private lines = new Map<VoiceLine, AudioBuffer>();
  private linesRequested = false;
  private speaking: AudioBufferSourceNode | null = null;
  private waiting: { line: VoiceLine; until: number } | null = null;

  private readonly silent: boolean;
  constructor(silent = false) {this.silent=silent;}

  /** Call from a click or key press so browsers can allow audio. */
  unlock() {
    if (this.silent || this.muted) return;
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();
        this.master.connect(limiter);
        limiter.connect(ctx.destination);
        this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.3), ctx.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        this.updateVolume();
        this.loadLines(ctx);
      }
      if (this.context.state === "suspended") void this.context.resume().catch(() => {});
    } catch {
      // Audio is optional; a browser without Web Audio can still play the game.
    }
  }

  toggle() {
    if (this.silent) return;
    this.muted = !this.muted;
    this.unlock();
    this.updateVolume();
  }

  /** Player preference from 0 to 1; mute and the silent lock still win. */
  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.updateVolume();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.waiting = null;
      for (const voice of this.voices) voice.stop();
    }
    this.updateVolume();
  }

  /** Requested once, after sound is switched on. A silent or muted session never fetches them. */
  private loadLines(ctx: AudioContext) {
    if (this.linesRequested) return;
    this.linesRequested = true;
    for (const line of VOICE_LINES)
      void fetch(`/assets/voice/${line}.mp3`)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(line))))
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          this.lines.set(line, buffer);
          const waiting = this.waiting;
          if (waiting?.line === line) {
            this.waiting = null;
            if (ctx.currentTime <= waiting.until) this.say(line);
          }
        })
        .catch(() => {
          // A missing line leaves the banner silent; effects still play.
        });
  }

  /** Speak one narrator line. A newer line replaces the one still playing. */
  say(line: VoiceLine, delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.master || this.muted || this.paused) return;
    const buffer = this.lines.get(line);
    if (!buffer) {
      // Sound was switched on a moment ago: speak when the line arrives, if still timely.
      this.waiting = { line, until: ctx.currentTime + delay + 1.5 };
      return;
    }
    if (ctx.state !== "running") return;
    this.waiting = null;
    this.speaking?.stop();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = VOICE_GAIN;
    source.connect(gain);
    gain.connect(this.master);
    this.voices.add(source);
    this.speaking = source;
    source.onended = () => {
      this.voices.delete(source);
      if (this.speaking === source) this.speaking = null;
      source.disconnect();
      gain.disconnect();
    };
    source.start(ctx.currentTime + delay);
  }

  private updateVolume() {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : 0.045 * this.volume, this.context.currentTime, 0.01);
  }

  private play(start: number, end: number, duration: number, volume: number, noise = false, delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.state !== "running" || this.muted || this.paused || this.voices.size >= 24) return;
    const at = ctx.currentTime + delay;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    gain.connect(this.master);
    let voice: AudioScheduledSourceNode;
    let filter: BiquadFilterNode | null = null;
    if (noise) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(start, at);
      filter.frequency.exponentialRampToValueAtTime(end, at + duration);
      source.connect(filter);
      filter.connect(gain);
      voice = source;
    } else {
      const source = ctx.createOscillator();
      source.type = "triangle";
      source.frequency.setValueAtTime(start, at);
      source.frequency.exponentialRampToValueAtTime(end, at + duration);
      source.connect(gain);
      voice = source;
    }
    this.voices.add(voice);
    voice.onended = () => {
      this.voices.delete(voice);
      voice.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
    voice.start(at);
    voice.stop(at + duration + 0.01);
  }

  /** Ritual bell: a low, resonant bronze strike with a soft mallet transient. */
  bell() {
    this.play(235, 233, 0.9, 0.3, false);
    this.play(470, 466, 0.6, 0.16, false, 0.004);
    this.play(705, 700, 0.4, 0.1, false, 0.008);
    this.play(800, 300, 0.25, 0.08, true);
  }
  /** A boss telegraphs: a low tension swell. */
  bossWarn() {
    this.play(90, 58, 0.55, 0.32, false);
    this.play(280, 90, 0.5, 0.18, true);
  }
  /** Boss phase change: deeper than the warning, under the narrator. */
  bossPhase() {
    this.play(64, 42, 0.8, 0.4, false);
    this.play(180, 60, 0.6, 0.22, true);
  }
  /** Boss dies: the loudest dark cue, still under a hit. */
  bossDeath() {
    this.play(150, 26, 1.0, 0.55, false);
    this.play(240, 35, 0.85, 0.28, true);
  }
  /** Boss door opens: low rumble with a slow creak. */
  gateOpen() {
    this.play(70, 48, 1.1, 0.34, false);
    this.play(130, 45, 1.0, 0.24, true);
  }
  /** Reward cards rise. */
  rewardOpen() {
    this.play(520, 523, 0.22, 0.2, false);
    this.play(780, 784, 0.3, 0.16, false, 0.09);
  }
  /** Reward choice confirmed. */
  rewardPick() {
    this.play(660, 990, 0.14, 0.24, false);
  }
  /** A new wave arrives: barely-there air. */
  waveArrive() {
    this.play(420, 900, 0.3, 0.1, true);
  }

  consume(events: readonly SimEvent[]) {
    // One cue of each kind per tick keeps a crowd hit from becoming deafening.
    const heard = new Set<SimEvent["type"]>();
    for (const e of events) {
      if (heard.has(e.type)) continue;
      heard.add(e.type);
      switch (e.type) {
        case 'ability': {
          if(e.side==='enemy'||!e.ability)break;
          const now=this.context?.currentTime??0,id=e.ability,t=techniqueId(id),ultimate=!t&&!isSpell(id),tier=ultimate||t?.endsWith('-4')?3:t?.endsWith('-3')?2:1;
          if(e.stage==='charge'){
            this.skillChain=now<this.skillUntil?Math.min(5,this.skillChain+1):1;this.skillUntil=now+abilityDuration(id)+1.4;
            this.play((ultimate?120:360)*(1+.06*this.skillChain),ultimate?65:620,.16,.22,true);
          }else if(e.stage==='release'){
            // Spell or soul-core release: cores are heavy and deep, spells mid and distinct.
            if(ultimate){
              this.play(70,30,.55,.5,false);
              this.play(140,40,.45,.3,true);
              this.play(90,60,.5,.25,false,.12);
            }else if(id==='lance'){
              this.play(320,150,.22,.3,false);
              this.play(1400,2200,.16,.14,true);
            }else if(id==='nova-spell'){
              this.play(200,90,.3,.32,false);
              this.play(500,220,.3,.16,true);
            }else{
              this.play(260,70,.32,.28,false);
              this.play(900,240,.28,.14,true);
            }
          }else if(e.stage==='pulse'){
            // Technique contact or zone pulse: one cue per ability per beat; heavy families sit lower.
            if(now-(this.pulseAt.get(id)??-1)<.1)break;
            this.pulseAt.set(id,now);
            if(ultimate){
              this.play(75,40,.3,.32,false);
              this.play(160,50,.28,.16,true);
            }else{
              const family=t?t.slice(0,t.indexOf('-')):'sword';
              const base={hammer:180,axe:190,dagger:260,sword:270,spear:300,crossbow:340,staff:380}[family]??270;
              this.play(base,base*.45,.11+tier*.04,.26+tier*.07,false);
              this.play(700+tier*200+this.skillChain*60,190,.08,.12,true);
            }
          }
          break;
        }
        case "swing":
          this.play(e.amount === 2 ? 900 : 1600, 220, 0.13, 0.35, true);
          break;
        case "hit":
          this.play(180, 55, 0.1, 0.65);
          break;
        case "kill":
          this.play(440, 660, 0.12, 0.25);
          break;
        case "hurt":
          this.play(110, 40, 0.24, 0.65);
          break;
        case "jump":
          this.play(320, 760, 0.12, 0.2, true);
          break;
        case "land":
          this.play(170, 70, 0.08, 0.3);
          break;
        case "plunge":
          this.play(150, 34, 0.32, 0.8);
          break;
        case "dash":
          this.play(600, 2400, 0.15, 0.3, true);
          break;
        case "cleared":
        case "floor":
        case "won":
          [330, 440, 660].forEach((hz, i) => this.play(hz, hz, 0.35, 0.3, false, i * 0.12));
          break;
        case "dead":
          this.play(180, 35, 0.7, 0.5);
          break;
      }
    }
  }
}
