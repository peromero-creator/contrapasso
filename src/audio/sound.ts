// Effects are CC0 samples (Kenney) plus a few quiet synthesized tones. Audio never reads or changes the simulation.
import { techniqueId, familyOf } from "../sim/techniques.ts";
import { isSpell } from "../sim/abilities.ts";
import type { SimEvent } from "../sim/world";

/**
 * CC0 samples from Kenney.nl "Impact Sounds" and "RPG Audio" under `public/assets/sfx/`.
 * Every cue has 2-3 variations; a missing file leaves that cue silent.
 * Gains are relative to one master bus: impacts dominate, UI cues sit lowest.
 */
const SAMPLES: Record<string, { files: string[]; gain: number }> = {
  swing: { files: ["impactMetal_light_000.ogg", "impactMetal_light_001.ogg", "impactMetal_light_002.ogg"], gain: 0.5 },
  hit: { files: ["impactPunch_heavy_000.ogg", "impactPunch_medium_000.ogg", "impactPlate_medium_000.ogg"], gain: 0.62 },
  kill: { files: ["impactPunch_heavy_002.ogg", "impactPlate_heavy_000.ogg", "impactMetal_heavy_000.ogg"], gain: 0.6 },
  hurt: { files: ["impactPunch_medium_001.ogg", "impactSoft_medium_000.ogg", "impactPunch_medium_002.ogg"], gain: 0.55 },
  dash: { files: ["cloth2.ogg", "cloth3.ogg", "cloth4.ogg"], gain: 0.4 },
  jump: { files: ["footstep_concrete_000.ogg", "footstep_concrete_001.ogg", "footstep00.ogg"], gain: 0.3 },
  land: { files: ["impactWood_heavy_000.ogg", "impactPlank_medium_000.ogg", "impactWood_medium_000.ogg"], gain: 0.4 },
  plunge: { files: ["impactSoft_heavy_000.ogg", "impactMining_000.ogg", "impactWood_heavy_001.ogg"], gain: 0.65 },
  bell: { files: ["impactBell_heavy_000.ogg", "impactBell_heavy_001.ogg", "impactBell_heavy_002.ogg"], gain: 0.55 },
  rewardOpen: { files: ["bookOpen.ogg", "cloth1.ogg", "bookFlip1.ogg"], gain: 0.32 },
  rewardPick: { files: ["metalClick.ogg", "bookClose.ogg", "metalLatch.ogg"], gain: 0.3 },
  gateOpen: { files: ["doorOpen_1.ogg", "doorOpen_2.ogg"], gain: 0.45 },
  bossDeath: { files: ["impactMining_001.ogg", "impactSoft_heavy_001.ogg", "impactMetal_heavy_001.ogg"], gain: 0.6 },
};

export class Sound {
  muted = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private paused = false;
  private volume = 1;
  private pulseAt = new Map<string, number>();
  private samples = new Map<string, AudioBuffer>();
  private samplesRequested = false;
  private sampleLast = new Map<string, number>();

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
        this.loadSamples(ctx);
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
      for (const voice of this.voices) voice.stop();
    }
    this.updateVolume();
  }

  /** Requested once, after sound is switched on. A silent or muted session never fetches them. */
  private loadSamples(ctx: AudioContext) {
    if (this.samplesRequested) return;
    this.samplesRequested = true;
    for (const { files } of Object.values(SAMPLES))
      for (const file of files)
        void fetch(`/assets/sfx/${file}`)
          .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(file))))
          .then((bytes) => ctx.decodeAudioData(bytes))
          .then((buffer) => {
            this.samples.set(file, buffer);
          })
          .catch(() => {
            // A missing file leaves that cue silent; the synthesized tones still play.
          });
  }

  /** Play one sampled cue: a variation never repeats back to back, at ±4% playback rate. */
  private sample(cue: string, delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.state !== "running" || this.muted || this.paused || this.voices.size >= 24) return;
    const def = SAMPLES[cue];
    if (!def) return;
    const buffers = def.files.map((f) => this.samples.get(f)).filter((b): b is AudioBuffer => !!b);
    if (buffers.length === 0) return;
    let index = Math.floor(Math.random() * buffers.length);
    if (buffers.length > 1 && index === this.sampleLast.get(cue)) index = (index + 1) % buffers.length;
    this.sampleLast.set(cue, index);
    const source = ctx.createBufferSource();
    source.buffer = buffers[index];
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    const gain = ctx.createGain();
    gain.gain.value = def.gain;
    source.connect(gain);
    gain.connect(this.master);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
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

  /** Ritual bell: a real CC0 bronze bell strike. */
  bell() {
    this.sample("bell");
  }
  /** A boss telegraphs: a low tension swell. */
  bossWarn() {
    this.play(90, 58, 0.55, 0.32, false);
    this.play(280, 90, 0.5, 0.18, true);
  }
  /** Boss phase change: deeper than the warning. */
  bossPhase() {
    this.play(64, 42, 0.8, 0.4, false);
    this.play(180, 60, 0.6, 0.22, true);
  }
  /** Boss dies: a heavy sample over the darkest low tone. */
  bossDeath() {
    this.sample("bossDeath");
    this.play(150, 26, 1.0, 0.4, false);
    this.play(240, 35, 0.85, 0.2, true);
  }
  /** Boss door opens: a recorded creak with a low rumble. */
  gateOpen() {
    this.sample("gateOpen");
    this.play(70, 48, 1.1, 0.25, false);
    this.play(130, 45, 1.0, 0.18, true);
  }
  /** Reward cards rise: book and cloth. */
  rewardOpen() {
    this.sample("rewardOpen");
  }
  /** Reward choice confirmed: a small metal click. */
  rewardPick() {
    this.sample("rewardPick");
  }
  /** A new wave arrives: barely-there air. */
  waveArrive() {
    this.sample("land");
  }

  consume(events: readonly SimEvent[]) {
    // One cue of each kind per tick keeps a crowd hit from becoming deafening.
    const heard = new Set<SimEvent["type"]>();
    for (const e of events) {
      if (heard.has(e.type)) continue;
      heard.add(e.type);
      switch (e.type) {
        case 'ability': {
          // Recorded CC0 impacts only: no synthesized charge, release or pulse tones.
          if(e.side==='enemy'||!e.ability)break;
          const now=this.context?.currentTime??0,id=e.ability,t=techniqueId(id),ultimate=!t&&!isSpell(id),tier=ultimate||t?.endsWith('-4')?3:t?.endsWith('-3')?2:1;
          if(e.stage==='release'){
            this.sample("plunge");
            if(ultimate)this.sample("kill",0.08);
          }else if(e.stage==='pulse'){
            if(now-(this.pulseAt.get(id)??-1)<.1)break;
            this.pulseAt.set(id,now);
            this.sample(ultimate||tier===3?"kill":"hit");
          }
          break;
        }
        case "swing":
          this.sample("swing");
          break;
        case "hit":
          this.sample("hit");
          break;
        case "kill":
          this.sample("kill");
          break;
        case "hurt":
          this.sample("hurt");
          break;
        case "jump":
          this.sample("jump");
          break;
        case "land":
          this.sample("land");
          break;
        case "plunge":
          this.sample("plunge");
          break;
        case "dash":
          this.sample("dash");
          break;
        case "cleared":
        case "floor":
        case "won":
          this.sample("bell");
          break;
        case "dead":
          this.sample("kill");
          break;
      }
    }
  }
}
