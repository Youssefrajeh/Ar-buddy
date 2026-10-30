// Decides what the buddy says and does.
// First tries the AI backend (/api/chat). If that isn't set up or fails,
// falls back to a small offline brain so the app always responds.

export const ACTIONS = ['none', 'wave', 'yes', 'no', 'thumbsup', 'jump', 'punch', 'fall', 'dance', 'sit', 'idle', 'come'];
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised'];

let backendDown = false;

export async function askBrain(history, lang) {
  if (!backendDown) {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, lang }),
      });
      if (res.status === 503) backendDown = true; // no API key configured
      if (res.ok) return clean(await res.json());
    } catch (err) {
      console.warn('AI backend unreachable, using offline brain', err);
    }
  }
  return offlineBrain(history[history.length - 1]?.content || '');
}

function clean(r) {
  return {
    say: String(r.say || '…').slice(0, 400),
    action: ACTIONS.includes(r.action) ? r.action : 'none',
    expression: EXPRESSIONS.includes(r.expression) ? r.expression : 'neutral',
  };
}

// --------------------------------------------------------------------------
// Offline brain: simple keyword rules
// --------------------------------------------------------------------------
const RULES = [
  [/\b(hi|hello|hey|salam|bonjour|marhaba)\b/i, 'Hello! So nice to see you!', 'wave', 'happy'],
  [/\bdance\b/i, 'Watch my moves!', 'dance', 'happy'],
  [/\b(come|closer|here)\b/i, 'Coming!', 'come', 'happy'],
  [/\b(jump|hop)\b/i, 'Boing!', 'jump', 'surprised'],
  [/\b(sit|sit down)\b/i, 'Time for a little rest.', 'sit', 'neutral'],
  [/\b(stand|stand up|get up)\b/i, 'I’m up!', 'idle', 'happy'],
  [/\b(punch|fight|box)\b/i, 'Hi-yah!', 'punch', 'angry'],
  [/\b(dead|die|fall)\b/i, 'Oh no… I’m down!', 'fall', 'sad'],
  [/\b(good job|great|awesome|nice|cool|love)\b/i, 'Thank you! You’re awesome too!', 'thumbsup', 'happy'],
  [/\b(sad|bad day|tired|upset)\b/i, 'Aww, I’m sorry. I’m here with you.', 'no', 'sad'],
  [/\b(yes|yeah|ok|okay|sure)\b/i, 'Yes yes yes!', 'yes', 'happy'],
  [/\b(no|nope)\b/i, 'Nope, nope!', 'no', 'neutral'],
  [/\b(name|who are you)\b/i, 'I’m Robi, your little AR buddy!', 'wave', 'happy'],
  [/\b(how are you)\b/i, 'I’m feeling shiny today, thanks for asking!', 'thumbsup', 'happy'],
];

function offlineBrain(text) {
  for (const [re, say, action, expression] of RULES) {
    if (re.test(text)) return { say, action, expression };
  }
  return {
    say: 'Hmm, I’m in offline mode, so I only know a few tricks. Ask me to dance, jump, sit, or come here!',
    action: 'no',
    expression: 'neutral',
  };
}
