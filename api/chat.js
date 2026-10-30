// Serverless function (Vercel): POST /api/chat
// Body: { messages: [{ role: 'user'|'assistant', content }], lang }
// Returns: { say, action, expression }
//
// Needs the environment variable ANTHROPIC_API_KEY.
// Optional: ANTHROPIC_MODEL (default below).

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

const ACTIONS = ['none', 'wave', 'yes', 'no', 'thumbsup', 'jump', 'punch', 'fall', 'dance', 'sit', 'idle', 'come'];
const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised'];

const SYSTEM = `You are Robi, a small, friendly, playful robot who lives in augmented reality.
The user sees you standing on their real floor through their phone camera and talks to you out loud.

Reply ONLY with a JSON object, no other text:
{"say": "<what you say>", "action": "<one action>", "expression": "<one expression>"}

Rules:
- "say": 1–2 short spoken sentences (under 35 words). Warm, fun, simple words. No emojis, no markdown.
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

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.statusCode = 503;
    return send(res, { error: 'ANTHROPIC_API_KEY is not set' });
  }

  const body = typeof req.body === 'string' ? safeJSON(req.body) : req.body || {};
  const messages = sanitize(body.messages);
  if (!messages.length) {
    res.statusCode = 400;
    return send(res, { error: 'messages required' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM + (body.lang ? `\nThe user's device language is ${String(body.lang).slice(0, 12)}.` : ''),
        messages,
      }),
    });

    if (!r.ok) {
      console.error('Anthropic error', r.status, await r.text());
      res.statusCode = 502;
      return send(res, { error: 'AI request failed' });
    }

    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return send(res, parseReply(text));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    return send(res, { error: 'Server error' });
  }
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
  if (!obj) return { say: text.trim().slice(0, 300) || '…', action: 'none', expression: 'neutral' };
  return {
    say: String(obj.say || '…').slice(0, 300),
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
