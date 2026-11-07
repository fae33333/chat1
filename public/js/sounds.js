// Web Audio API Sound Synthesizer for SoulChill
// Generates realistic soundboard effects, dice roll sounds, gift chimes, and ambient chill music
class SoundManager {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.bgmOscillators = [];
    this.bgmPlaying = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 1. Dice Roll Sound 🎲
  playDiceSound() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + (i * 0.06);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300 + Math.random() * 400, time);
      osc.frequency.exponentialRampToValueAtTime(80, time + 0.05);

      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.06);
    }
  }

  // 2. Gift Sent Chime 🎁✨
  playGiftSound(luxury = false) {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = luxury 
      ? [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98] // C5, E5, G5, C6, E6, G6 (Grand Fanfare)
      : [523.25, 659.25, 783.99, 1046.50]; // Sparkle

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + (idx * 0.08);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.45);
    });
  }

  // 3. Soundboard: Applause 👏
  playApplause() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    // Simulate crowd clapping with noise bursts
    for (let i = 0; i < 25; i++) {
      const delay = Math.random() * 1.5;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = this.ctx.currentTime + delay;

      osc.type = 'square';
      osc.frequency.setValueAtTime(150 + Math.random() * 200, time);

      gain.gain.setValueAtTime(0.05, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.09);
    }
  }

  // 4. Soundboard: Cheers 🎉
  playCheer() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    // Ascending celebratory triad
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + i * 0.1;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.65);
    });
  }

  // 5. Soundboard: Laughter 😂
  playLaughter() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + (i * 0.12);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600 + (i % 2 === 0 ? 80 : 0), time);
      osc.frequency.exponentialRampToValueAtTime(400, time + 0.1);

      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.11);
    }
  }

  // 6. Soundboard: Drumroll 🥁
  playDrumroll() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    for (let i = 0; i < 18; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + (i * 0.05);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(50, time + 0.04);

      gain.gain.setValueAtTime(0.1 + (i * 0.01), time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.05);
    }

    // Final crash
    setTimeout(() => {
      const crashOsc = this.ctx.createOscillator();
      const crashGain = this.ctx.createGain();
      const time = this.ctx.currentTime;
      crashOsc.type = 'sawtooth';
      crashOsc.frequency.setValueAtTime(800, time);
      crashGain.gain.setValueAtTime(0.2, time);
      crashGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
      crashOsc.connect(crashGain);
      crashGain.connect(this.ctx.destination);
      crashOsc.start(time);
      crashOsc.stop(time + 0.5);
    }, 18 * 50);
  }

  // 7. Ambient Chill Beat / Lofi chord loop 🎵
  toggleChillMusic(onStart, onStop) {
    this.init();
    if (!this.ctx) return;

    if (this.bgmPlaying) {
      this.stopChillMusic();
      if (onStop) onStop();
      return false;
    }

    this.bgmPlaying = true;
    const chords = [
      [261.63, 329.63, 392.00, 493.88], // Cmaj7
      [220.00, 261.63, 329.63, 392.00], // Am7
      [174.61, 220.00, 261.63, 329.63], // Fmaj7
      [196.00, 246.94, 293.66, 349.23]  // G7
    ];

    let chordIdx = 0;
    this.bgmInterval = setInterval(() => {
      if (!this.bgmPlaying) return;
      const now = this.ctx.currentTime;
      const currentChord = chords[chordIdx % chords.length];
      chordIdx++;

      currentChord.forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.025, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 2.3);
      });
    }, 2400);

    if (onStart) onStart();
    return true;
  }

  stopChillMusic() {
    this.bgmPlaying = false;
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  }

  // 8. Pop / Tap UI click sound
  playClick() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const time = this.ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, time);
    osc.frequency.exponentialRampToValueAtTime(300, time + 0.04);

    gain.gain.setValueAtTime(0.08, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + 0.05);
  }

  // 9. Level Up & Soul Match Triumph Fanfare 🌟🎉
  playLevelUp() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    // Ascending celebratory arpeggio: C5 -> E5 -> G5 -> C6 -> E6
    const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + (idx * 0.09);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.18, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.65);
    });
  }

  // 10. PK Battle Start Horn / Gong ⚔️🔥
  playPkStart() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    // Low gong + rising horn fanfare
    const freqs = [220, 277.18, 329.63, 440, 554.37];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const time = now + (idx * 0.12);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.75);
    });
  }

  // 11. PK Victory Triumph & Grand Award 🏆👑
  playVictory() {
    this.init();
    if (this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [
      { f: 523.25, d: 0.15 }, // C5
      { f: 523.25, d: 0.15 }, // C5
      { f: 523.25, d: 0.15 }, // C5
      { f: 659.25, d: 0.35 }, // E5
      { f: 783.99, d: 0.25 }, // G5
      { f: 1046.50, d: 0.8 }  // C6
    ];

    let t = now;
    notes.forEach(n => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.f, t);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + n.d);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + n.d);
      t += n.d * 0.85;
    });
  }
}

window.soundManager = new SoundManager();
