// Tiny synthesized SFX engine — all sounds generated with Web Audio oscillators
// and noise, no asset files. The context is created lazily on the first user
// gesture (resume) to satisfy autoplay policies.
export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  resume() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // 1s of white noise reused for hits / whistle texture
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private get t() {
    return this.ctx!.currentTime;
  }

  private tone(
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    freqEnd?: number
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, gain: number, freq: number, q = 1) {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx!.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filt).connect(g).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  // ---- named effects ----
  select() {
    if (!this.ctx) return;
    this.tone(520, this.t, 0.08, "square", 0.18);
    this.tone(780, this.t + 0.06, 0.08, "square", 0.16);
  }
  snap() {
    if (!this.ctx) return;
    this.tone(150, this.t, 0.12, "sawtooth", 0.3, 70);
    this.noise(this.t, 0.08, 0.25, 380, 0.6);
  }
  throw() {
    if (!this.ctx) return;
    this.noise(this.t, 0.18, 0.22, 1200, 0.8);
  }
  kick() {
    if (!this.ctx) return;
    this.tone(120, this.t, 0.14, "sawtooth", 0.35, 60);
    this.noise(this.t, 0.1, 0.4, 500, 0.5);
  }
  catchBall() {
    if (!this.ctx) return;
    this.tone(660, this.t, 0.1, "triangle", 0.3, 990);
  }
  tackle() {
    if (!this.ctx) return;
    this.noise(this.t, 0.16, 0.5, 220, 0.5);
    this.tone(90, this.t, 0.16, "sawtooth", 0.3, 50);
  }
  whistle() {
    if (!this.ctx) return;
    // shrill warble
    const a = this.t + 0.02;
    this.tone(2600, a, 0.18, "square", 0.18, 2750);
    this.tone(2750, a + 0.16, 0.16, "square", 0.18, 2600);
  }
  firstDown() {
    if (!this.ctx) return;
    this.tone(700, this.t, 0.1, "square", 0.22);
    this.tone(900, this.t + 0.09, 0.12, "square", 0.22);
  }
  touchdown() {
    if (!this.ctx) return;
    const n = [523, 659, 784, 1047];
    n.forEach((f, i) => this.tone(f, this.t + i * 0.12, 0.22, "square", 0.28));
    this.tone(1568, this.t + 0.48, 0.4, "square", 0.26);
  }
  turnover() {
    if (!this.ctx) return;
    const n = [600, 500, 380, 280];
    n.forEach((f, i) => this.tone(f, this.t + i * 0.1, 0.16, "sawtooth", 0.24));
  }
}
