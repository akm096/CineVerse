# CineVerse

CineVerse is a lightweight watch-party app for watching videos with friends in synced rooms. It supports direct video links, a persistent movie/series library, subtitles, real-time chat, message reactions, editable messages, and host-controlled room permissions.

Live app: https://newcineverse.sensei.web.tr

Cloudflare Pages preview: https://cineverse-9rp.pages.dev

Repository: https://github.com/akm096/CineVerse

## Current Version

`v1.3.7`

## Latest Changes

- Added protection so site admins cannot be banned, kicked, or muted in rooms.
- Added a "Banlananlar" (Banned users) tab for room managers to view and unban room members.
- Synced the banned list across the P2P connection to all room managers.
- Fixed desktop UI issues by hiding mobile-only elements on wider screens and eliminating empty bottom space.
- Added room moderation roles, mute, kick and ban controls in `v1.3.5`.

## Features

| Feature | Details |
|---|---|
| Synced rooms | Create a room, share the room link, and watch together over PeerJS/WebRTC. |
| Active public rooms | Public rooms appear in the Room tab so anyone can join an active watch session. |
| Private rooms | New rooms default to private and only work through direct shared room links. |
| Host controls | Host can decide whether guests may change video or playback state. |
| Room visibility | Host can switch a room between public and private from room settings. |
| Room labels | Hosts can add a room name and short description for the public room list. |
| Video sources | Supports MP4, M3U8/HLS, YouTube, Google Drive proxy links, Sibnet page-link resolving, and iframe-based embeds. |
| Playback tools | Play/pause, seek, volume, mute, speed from 0.25x to 3x, fullscreen. |
| Subtitles | Load SRT, VTT, JSON, or ASS subtitles from file drag-drop or URL. |
| Personal subtitles | Each user can keep their own subtitle selection without forcing it on others. |
| Shared subtitles | Optional host-shared subtitle mode for rooms that want one common subtitle. |
| Subtitle styling | Font size, color, background, opacity, and top/bottom position controls. |
| Chat | Real-time chat with emoji picker, replies, image upload/paste, and notification sound. |
| Message reactions | React to messages with heart, like, and laugh reactions. |
| Typing indicator | Shows when another room member is writing. |
| Edit own messages | Text messages you sent can be edited after sending. |
| Accounts | Login-backed roles for admin, uploader, and normal users. |
| Persistent library | Approved movies and series episodes can be loaded directly into rooms. |
| Series management | Admin/uploader users can create a series record first, then add ordered season/episode links. |
| Library admin page | `library-admin.html` provides series creation, episode upload, movie upload, search, filtering, and admin deletion. |
| Admin thumbnails | TMDB/poster images are shown in the management lists as well as in the player library. |
| Admin quick actions | Management rows can copy the media link, open the player with that media selected, and let admins edit existing movies or episodes. |
| Signed media URLs | MP4 links with query parameters are preserved; Sibnet page links are resolved at play time so short-lived `dv*.sibnet.ru/*.mp4?...` links do not need to be stored. |
| Library subtitles | Movies and episodes can store an optional subtitle URL that auto-loads in the player. |
| Watchlist | Logged-in users can save items as planned, watching, or watched. |
| Continue watching | Logged-in progress is saved in D1; guests keep local progress on the device. |
| Profile | Logged-in users can edit a display profile and see watch stats plus recent progress. |
| Admin dashboard | Admin users can see user/content/pending/public-room counters in the player admin tab. |
| API protection | Sensitive write endpoints have simple D1-backed rate limiting. |
| Theme | Dark/light theme toggle with saved preference. |

## Quick Start

1. Open the live app.
2. Enter a username, or log in for library/list/progress features.
3. Create a private room, join with a room link, or pick a public room from the active rooms list.
4. If you are the host, optionally switch the room to public in Room settings.
5. Open the Library tab or paste a video URL manually.
6. Load the content into the room.
7. Share the room link with friends.
8. Optional: open the Subtitle tab and choose either personal subtitles or host-shared subtitles.

## Library Administration

Open:

```text
/library-admin.html
```

Role behavior:

| Role | Access |
|---|---|
| `admin` | Create movies, create series, add episodes, approve/reject suggestions, edit series metadata, and permanently delete movies, episodes, or whole series. |
| `uploader` | Create movies, create series, and add episodes directly to the approved library. Delete and edit controls are hidden and blocked by the API. |
| `user` / guest | Cannot access the management workspace. Normal users can still suggest links through the player library form. |

Series flow:

1. Create the parent series record with title, description, poster, and optional TMDB lookup.
2. Select that series in the episode form.
3. Add season, episode, optional episode title, and video URL.
4. The player Library tab shows one expandable series card with episodes ordered by season and episode.

Admin deletion is permanent in this version. Deleting a series also deletes its connected episodes.

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
npm run verify
npx cap sync android
```

To build locally, Java 21 or newer and the Android SDK are required.

## Project Structure

```text
CineVerse/
├── index.html
├── player.html
├── library-admin.html
├── gdrive-worker.js
├── functions/
│   ├── proxy.js
│   ├── hls.js
│   ├── sibnet.js
│   └── api/[[path]].js
├── migrations/
│   ├── 0001_cineverse_library.sql
│   ├── 0002_series_library.sql
│   ├── 0003_content_subtitles.sql
│   ├── 0004_public_rooms.sql
│   ├── 0005_roadmap_foundation.sql
│   └── 0006_quality_tables.sql
├── css/
│   └── style.css
└── js/
    ├── account.js
    ├── app.js
    ├── chat.js
    ├── library-admin.js
    ├── player.js
    └── subtitles.js
```

## Main Files

| File | Purpose |
|---|---|
| `index.html` | Landing/home page. |
| `player.html` | Main room, video, chat, subtitle, library, watchlist, and settings UI. |
| `library-admin.html` | Admin/uploader library management page. |
| `css/style.css` | App layout, themes, chat UI, subtitle UI, library UI, admin UI, and responsive behavior. |
| `functions/api/[[path]].js` | Cloudflare Pages API for auth, library, series, watchlist, progress, public room registry, and admin actions. |
| `functions/sibnet.js` | Cloudflare Pages resolver for Sibnet page links and current MP4 sources. |
| `js/account.js` | Login state, player library, watchlist, progress, and player-side admin panel wiring. |
| `js/app.js` | Room creation/joining, PeerJS sync, public/private room visibility, active room list, room settings, and subtitle sharing mode. |
| `js/library-admin.js` | Dedicated library management UI logic. |
| `js/player.js` | Video loading and playback controls. |
| `js/chat.js` | Chat messages, replies, images, reactions, typing indicator, editing. |
| `js/subtitles.js` | Subtitle parser and text lookup engine. |
| `gdrive-worker.js` | Cloudflare Worker helper for Google Drive media proxying. |

## Deployment

### Cloudflare Pages

This app is static plus Cloudflare Pages Functions and can be deployed directly from the project root.

```bash
npx wrangler pages deploy . --project-name cineverse --commit-dirty=true
```

There is no build command and no output directory. Use `/` as the project root.

### Accounts, Library, Series, and D1

The account, admin panel, persistent library, series model, watchlist, and continue-watching APIs use Cloudflare Pages Functions with a D1 binding.

1. Create a D1 database in Cloudflare.
2. Bind it to Pages Functions as `DB` or `CINEVERSE_DB`.
3. Apply the SQL files in `migrations/` in order:

```bash
npx wrangler d1 execute cineverse-db --remote --file migrations/0001_cineverse_library.sql
npx wrangler d1 execute cineverse-db --remote --file migrations/0002_series_library.sql
npx wrangler d1 execute cineverse-db --remote --file migrations/0003_content_subtitles.sql
npx wrangler d1 execute cineverse-db --remote --file migrations/0004_public_rooms.sql
npx wrangler d1 execute cineverse-db --remote --file migrations/0005_roadmap_foundation.sql
npx wrangler d1 execute cineverse-db --remote --file migrations/0006_quality_tables.sql
npx wrangler d1 execute cineverse-db --remote --file migrations/0007_moderator_role.sql
```

If an existing database already has `0001` through `0006`, apply only `0007_moderator_role.sql`.

The API also performs a small startup schema check for series, content metadata, profiles, notifications, public rooms, quality tables, and rate-limit tables, so existing deployments can recover if the D1 management command was not run before deploy. Running the migration explicitly is still recommended.

Set these environment variables for the first admin account:

```text
CV_ADMIN_USERNAME=admin
CV_ADMIN_PASSWORD=change-this-password
```

Optional TMDB auto-fill:

```text
TMDB_API_KEY=your_tmdb_api_key
```

If TMDB is not configured, manual link submission still works.

The first migration also seeds an initial admin account:

```text
username: akm09
password: test1234
```

Change this password from the admin panel after deployment.

## GitHub

The active repository is:

```text
https://github.com/akm096/CineVerse
```

## Notes

- PeerJS needs an HTTP/HTTPS context.
- New rooms default to private. Public rooms are shown only while the host heartbeat is active.
- Private rooms never appear in the active rooms list, but direct `player.html?room=...` links still work.
- Subtitle mode defaults to personal, so new users can choose their own subtitles independently.
- If the host switches subtitle mode to shared, host-loaded subtitles are sent to the room.
- Chat reactions and edits are synced by message id inside the active room session.
- Series are stored in the `series` table; individual episodes remain in `contents` with `type = 'series'` and `series_id`.
- Movie rows keep `series_id = null`.
- Admin/uploader additions are approved immediately; normal user suggestions still go through admin approval.

## License

MIT
