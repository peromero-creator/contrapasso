// Original, quiet effects generated locally. Audio never reads or changes the simulation.
import type { SimEvent } from "../sim/world";

export class Sound {
  muted = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private paused = false;

  constructor(private readonly silent = false) {}

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

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) for (const voice of this.voices) voice.stop();
    this.updateVolume();
  }

  private updateVolume() {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : 0.045, this.context.currentTime, 0.01);
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

  consume(events: readonly SimEvent[]) {
    // One cue of each kind per tick keeps a crowd hit from becoming deafening.
    const heard = new Set<SimEvent["type"]>();
    for (const e of events) {
      if (heard.has(e.type)) continue;
      heard.add(e.type);
      switch (e.type) {
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
