# CineVerse

CineVerse is a lightweight watch-party app for watching videos with friends in synced rooms. It supports direct video links, subtitles, real-time chat, message reactions, editable messages, and host-controlled room permissions.

Live app: https://newcineverse.sensei.web.tr

Cloudflare Pages preview: https://cineverse-9rp.pages.dev

Repository: https://github.com/akm096/CineVerse

## Features

| Feature | Details |
|---|---|
| Synced rooms | Create a room, share the room link, and watch together over PeerJS/WebRTC. |
| Host controls | Host can decide whether guests may change video or playback state. |
| Video sources | Supports MP4, M3U8/HLS, YouTube, Google Drive proxy links, and iframe-based embeds. |
| Playback tools | Play/pause, seek, volume, mute, speed from 0.25x to 3x, fullscreen. |
| Subtitles | Load SRT, VTT, JSON, or ASS subtitles from file drag-drop or URL. |
| Personal subtitles | Each user can keep their own subtitle selection without forcing it on others. |
| Shared subtitles | Optional host-shared subtitle mode for rooms that want one common subtitle. |
| Subtitle styling | Font size, color, background, opacity, and top/bottom position controls. |
| Chat | Real-time chat with emoji picker, replies, image upload/paste, and notification sound. |
| Message reactions | React to messages with heart, like, and laugh reactions. |
| Typing indicator | Shows when another room member is writing. |
| Edit own messages | Text messages you sent can be edited after sending. |
| Room version label | The room panel shows the current app version. |
| Theme | Dark/light theme toggle with saved preference. |

## Current Version

`v1.1.0`

## Quick Start

1. Open the live app.
2. Enter a username.
3. Create a room or join with a room link.
4. Paste a video URL and load it.
5. Share the room link with friends.
6. Optional: open the Subtitle tab and choose either personal subtitles or host-shared subtitles.

## Local Run

Use an HTTP server. The room system will not work correctly from `file://`.

```bash
git clone https://github.com/akm096/CineVerse.git
cd CineVerse
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/player.html
```

## Android APK

This repository is ready to build an Android APK with GitHub Actions.

1. Push the project to the `main` or `master` branch on GitHub.
2. Open the repository on GitHub.
3. Go to **Actions**.
4. Open **Build Android APK**.
5. Run the workflow manually, or wait for it to run after a push.
6. Download `CineVerse-debug-apk` from the workflow artifacts.

On normal pushes, the workflow also creates a GitHub Release with the debug APK attached.

Local Android preparation:

```bash
npm install
npm run prepare:web
npx cap sync android
```

To build locally, Java 21 or newer and the Android SDK are required.

## Project Structure

```text
CineVerse/
├── index.html
├── player.html
├── gdrive-worker.js
├── functions/
│   └── proxy.js
├── css/
│   └── style.css
└── js/
    ├── app.js
    ├── chat.js
    ├── player.js
    └── subtitles.js
```

## Main Files

| File | Purpose |
|---|---|
| `index.html` | Landing/home page. |
| `player.html` | Main room, video, chat, subtitle, and settings UI. |
| `css/style.css` | App layout, themes, chat UI, subtitle UI, responsive behavior. |
| `js/app.js` | Room creation/joining, PeerJS sync, room settings, subtitle sharing mode. |
| `js/player.js` | Video loading and playback controls. |
| `js/chat.js` | Chat messages, replies, images, reactions, typing indicator, editing. |
| `js/subtitles.js` | Subtitle parser and text lookup engine. |
| `gdrive-worker.js` | Cloudflare Worker helper for Google Drive media proxying. |

## Deployment

### Cloudflare Pages

This app is static and can be deployed directly from the project root.

```bash
npx wrangler pages deploy . --project-name cineverse --commit-dirty=true
```

There is no build command and no output directory. Use `/` as the project root.

### GitHub

The active repository is:

```text
https://github.com/akm096/CineVerse
```

Recent work has been pushed to:

```text
codex/chat-images-replies
```

## Notes

- PeerJS needs an HTTP/HTTPS context.
- Subtitle mode defaults to personal, so new users can choose their own subtitles independently.
- If the host switches subtitle mode to shared, host-loaded subtitles are sent to the room.
- Chat reactions and edits are synced by message id inside the active room session.

## License

MIT
