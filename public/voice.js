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

  speak(text) {
    if (!('speechSynthesis' in window) || !text) {
      // No TTS: still animate the mouth for a moment
      this.onSpeakStart();
      setTimeout(() => this.onSpeakEnd(), Math.min(6000, 60 * text.length));
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    u.pitch = 1.35; // a bit robot-cute
    u.rate = 1.05;
    u.onstart = () => this.onSpeakStart();
    u.onend = u.onerror = () => this.onSpeakEnd();
    speechSynthesis.speak(u);
  }

  stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
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
