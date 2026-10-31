// Listening (Web Speech API) and speaking (speechSynthesis)

export class Voice {
  constructor(lang) {
    this.lang = lang;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.SR = SR;
    this.canListen = !!SR;
    this.listening = false;
    this.onSpeakStart = () => {};
    this.onSpeakEnd = () => {};
    this.onError = null;
    this.voice = null;

    if ('speechSynthesis' in window) {
      const pick = () => (this.voice = pickVoice(lang));
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  listen({ onResult, onEnd, onError }) {
    if (!this.SR) return;
    const rec = new this.SR();
    rec.lang = this.lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    this.rec = rec;
    this.listening = true;

    let gotResult = false;
    rec.onresult = (e) => {
      gotResult = true;
      onResult(e.results[0][0].transcript);
    };
    rec.onerror = (e) => onError?.(e.error);
    rec.onend = () => {
      this.listening = false;
      onEnd?.(gotResult);
    };
    try {
      rec.start();
    } catch (err) {
      this.listening = false;
      onError?.(err.message);
      onEnd?.(false);
    }
  }

  stopListening() {
    try { this.rec?.stop(); } catch { /* already stopped */ }
  }

  // Call this directly inside a tap handler (Start button, mic button).
  // Chrome on Android only allows speech after a real user gesture; speaking a
  // silent utterance during the tap "unlocks" it for the rest of the session.
  unlock() {
    if (this.unlocked || !('speechSynthesis' in window)) return;
    this.unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  speak(text) {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      // No TTS: still animate the mouth for a moment
      this.onSpeakStart();
      setTimeout(() => this.onSpeakEnd(), Math.min(6000, 60 * text.length));
      return;
    }
    const synth = speechSynthesis;
    if (!this.voice) this.voice = pickVoice(this.lang); // Android loads voices late

    const go = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice?.lang || this.lang;
      if (this.voice) u.voice = this.voice;
      u.pitch = 1.35; // a bit robot-cute
      u.rate = 1.05;
      u.volume = 1;
      let started = false;
      u.onstart = () => {
        started = true;
        this.onSpeakStart();
      };
      u.onend = () => this.onSpeakEnd();
      u.onerror = (e) => {
        this.onSpeakEnd();
        if (e.error !== 'interrupted' && e.error !== 'canceled') this.onError?.(e.error);
      };
      // Keep a reference: Chrome can garbage-collect the utterance mid-speech
      this.utterance = u;
      synth.speak(u);

      // Chrome sometimes leaves the queue paused; nudge it, then report if still silent
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => {
        if (started) return;
        synth.resume();
        this.watchdog = setTimeout(() => {
          if (!started && !synth.speaking) {
            this.onSpeakEnd();
            this.onError?.('no-audio');
          }
        }, 1500);
      }, 1000);
    };

    // Chrome Android bug: cancel() immediately followed by speak() drops the new speech.
    // Only cancel when something is actually playing, and wait a moment before speaking.
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(go, 250);
    } else {
      go();
    }
  }

  stopSpeaking() {
    clearTimeout(this.watchdog);
    if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) {
      speechSynthesis.cancel();
    }
    this.onSpeakEnd();
  }
}

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split('-')[0].toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}
