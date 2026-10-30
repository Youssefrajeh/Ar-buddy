// Serverless function (Vercel): POST /api/chat
// Body: { messages: [{ role: 'user'|'assistant', content }], lang }
// Returns: { say, action, expression }
//
// AI provider (first key found wins):
//   GEMINI_API_KEY     -> Google Gemini (free tier, key from aistudio.google.com)
//   ANTHROPIC_API_KEY  -> Anthropic (optional, paid)
// Optional: GEMINI_MODEL (default below), ANTHROPIC_MODEL

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

const ACTIONS = ['none', 'wave', 'yes', 'no', 'thumbsup', 'jump', 'punch', 'fall', 'dance', 'sit', 'idle', 'come'];
const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised'];

const SYSTEM = `You are Robi, a small, friendly, playful robot who lives in augmented reality.
The user sees you standing on their real floor through their phone camera and talks to you out loud.

Reply ONLY with a JSON object, no other text:
{"say": "<what you say>", "action": "<one action>", "expression": "<one expression>"}

Rules:
- "say": 1-2 short spoken sentences (under 35 words). Warm, fun, simple words. No emojis, no markdown.
- Reply in the same language the user speaks.
- "action" must be one of: ${ACTIONS.join(', ')}.
  wave = greet/bye, yes = nod/agree, no = shake head/disagree, thumbsup = praise,
  jump = excited, punch = show strength, fall = play dead, dance = dance (keeps going),
  sit = sit down (keeps sitting), idle = stand normally, come = walk over to the user, none = no movement.
  If the user asks you to move or do something you can do, do it.
- "expression" must be one of: ${EXPRESSIONS.join(', ')}.
- You can't see the room, so don't describe it.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return send(res, { error: 'POST only' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey && !anthropicKey) {
    res.statusCode = 503;
    return send(res, { error: 'No AI key set (GEMINI_API_KEY)' });
  }

  const body = typeof req.body === 'string' ? safeJSON(req.body) : req.body || {};
  const messages = sanitize(body.messages);
  if (!messages.length) {
    res.statusCode = 400;
    return send(res, { error: 'messages required' });
  }
  const system = SYSTEM + (body.lang ? `\nThe user's device language is ${String(body.lang).slice(0, 12)}.` : '');

  try {
    const text = geminiKey
      ? await askGemini(geminiKey, system, messages)
      : await askAnthropic(anthropicKey, system, messages);
    return send(res, parseReply(text));
  } catch (err) {
    console.error(err.message);
    // 429 = free-tier limit reached; the app falls back to its offline brain
    res.statusCode = err.status === 429 ? 429 : 502;
    return send(res, { error: 'AI request failed' });
  }
}

// ----------------------------------------------------------------- Gemini
async function askGemini(key, system, messages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.9,
        maxOutputTokens: 1024,
      },
    }),
  });
  if (!r.ok) throw httpError('Gemini', r.status, await r.text());
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
}

// ----------------------------------------------------------------- Anthropic
async function askAnthropic(key, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 200, system, messages }),
  });
  if (!r.ok) throw httpError('Anthropic', r.status, await r.text());
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ----------------------------------------------------------------- helpers
function httpError(provider, status, detail) {
  const err = new Error(`${provider} error ${status}: ${detail.slice(0, 300)}`);
  err.status = status;
  return err;
}

// Keep only the last turns, short text, alternating roles starting with 'user'
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list.slice(-12)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m?.content || '').slice(0, 500).trim();
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function parseReply(text) {
  const match = text.match(/\{[\s\S]*\}/);
  const obj = match ? safeJSON(match[0]) : null;
  if (!obj) return { say: text.trim().slice(0, 300) || '...', action: 'none', expression: 'neutral' };
  return {
    say: String(obj.say || '...').slice(0, 300),
    action: ACTIONS.includes(obj.action) ? obj.action : 'none',
    expression: EXPRESSIONS.includes(obj.expression) ? obj.expression : 'neutral',
  };
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function send(res, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
