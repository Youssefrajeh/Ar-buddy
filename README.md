# AR Buddy

A web app where a little robot appears **on your real floor** through your phone camera.
You can **talk to it**, it **answers out loud**, and it **acts it out**: it waves, nods, dances, sits, jumps, plays dead, or walks over to you.

No app install: it's just a website (WebXR + three.js).

## How it works

```
you speak ──► Speech-to-text (Web Speech API, in the browser)
          ──► /api/chat (serverless function) ──► AI model
          ◄── { "say": "...", "action": "dance", "expression": "happy" }
robot ◄── speaks the reply (speechSynthesis) + plays the animation + changes face
```

| Part | File | What it does |
|---|---|---|
| AR + scene | `public/main.js` | WebXR session, floor detection (hit-test), tap to place, real-room lighting, preview mode, UI |
| Character | `public/character.js` | Loads the robot, animations, walking, turning to face you, facial expressions, talking head-bob |
| Voice | `public/voice.js` | Listening (speech recognition) and speaking (text-to-speech) |
| Brain (client) | `public/brain.js` | Calls the backend; falls back to an **offline brain** (keyword rules) if no AI is set up |
| Brain (server) | `api/chat.js` | Keeps the API key secret, asks the AI for a short reply + one action + one expression as JSON |
| Local server | `dev-server.js` | Serves the site and the API locally with zero dependencies |

### What you can do
- **Tap the floor** → the robot pops in and waves
- **Tap the floor somewhere else** → it walks there
- **Tap the robot** → it jumps ("Boop!")
- **Tap the mic and talk** (or type) → it answers out loud and does an action:
  `wave · yes · no · thumbsup · jump · punch · fall (play dead) · dance · sit · idle · come (walks to you)`
- It always **turns to face you** as you walk around it

## Device support

| Device | Mode |
|---|---|
| Android phone with Chrome + ARCore ("Google Play Services for AR") | **Full AR**: robot stands on your real floor |
| iPhone / iPad (Safari doesn't support WebXR AR) | Camera **preview mode**: robot over the camera feed, no floor tracking |
| Desktop | Preview mode (webcam if available) |

Voice input works best in **Chrome**. If it's not available, there's a text box.

## Run it locally

Needs Node 18+. There's nothing to install.

```bash
# without AI (offline brain: dance / jump / sit / come here / hello ...)
node dev-server.js

# with AI
ANTHROPIC_API_KEY=sk-ant-... node dev-server.js
```

Open http://localhost:3000.

### Test on your Android phone from your laptop
The camera, mic and AR only work on **HTTPS** or **localhost**. The easiest way:

1. On your phone: Settings → About phone → tap *Build number* 7 times → enable **USB debugging** in Developer options
2. Plug the phone into the laptop with USB
3. In desktop Chrome open `chrome://inspect/#devices` → **Port forwarding** → add `3000` → `localhost:3000` → enable
4. On the phone, open Chrome and go to `http://localhost:3000` → **Start AR**

(Or just deploy it, see below, and open the HTTPS link on your phone.)

## Deploy to Vercel (free HTTPS link)

```bash
npm i -g vercel
vercel          # first time: link/create the project
vercel env add ANTHROPIC_API_KEY   # paste your key (Production)
vercel --prod
```

Or push to GitHub and import the repo in the Vercel dashboard, then add `ANTHROPIC_API_KEY` under **Settings → Environment Variables**.
`vercel.json` already tells Vercel to serve the `public/` folder; `api/chat.js` becomes the `/api/chat` function automatically.

Optional env var: `ANTHROPIC_MODEL` (default `claude-haiku-5-5`, which is fast and cheap, good for voice).

> **Note:** The `/api/chat` endpoint is public once deployed, so anyone with the link uses your API key.
> It already limits message length, history and reply size. Before sharing widely, add a spending limit on your API account, or rate limiting (e.g. Vercel KV / Upstash).

## Ideas for next steps
- **Your own character**: any rigged `.glb` with animations works (e.g. from [Mixamo](https://www.mixamo.com/)). Change the file name in `main.js` and the clip names in `character.js`.
- **Occlusion**: hide the robot behind real furniture with WebXR `depth-sensing`
- **Better voice**: swap `speechSynthesis` for a TTS API, and drive the mouth from the audio volume
- **Memory**: save the conversation in `localStorage` so it remembers your name
- **Other languages**: open the site with `?lang=ar-SA` or `?lang=fr-FR` to listen and speak in that language

## Credits
- Robot model: "RobotExpressive" by Tomás Laulhé (Quaternius), facial morphs by Don McCurdy: **CC0** (`public/MODEL-LICENSE.md`)
- [three.js](https://threejs.org) r187: MIT (`public/lib/three/LICENSE`), bundled locally so the app has no CDN dependency
