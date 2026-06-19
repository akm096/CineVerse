/**
 * CineVerse — Video Player Controller
 * Supports: MP4 (native), M3U8/HLS (via hls.js), Google Drive (proxy), YouTube (IFrame API), Sibnet resolver
 */
const PlayerController = (() => {
  let video, hlsInstance;
  let isHLS = false;
  let onSyncCallback = null; // called when user does play/pause/seek
  let userPlaybackRate = 1;
  let syncCorrectionTimer = null;
  let syncStatusTimer = null;
  let syncStatusEl = null;
  let controlsHideTimer = null;

  // YouTube state
  let ytPlayer = null;
  let isYouTube = false;
  let ytReady = false;
  let ytAPILoaded = false;
  let ytUpdateInterval = null;
  let pendingYTVideoId = null;

  function init() {
    video = document.getElementById('videoPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const timeDisplay = document.getElementById('timeDisplay');
    const volumeSlider = document.getElementById('volumeSlider');
    const muteBtn = document.getElementById('muteBtn');
    const speedSelect = document.getElementById('speedSelect');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const rewind10Btn = document.getElementById('rewind10Btn');
    const forward10Btn = document.getElementById('forward10Btn');
    const videoContainer = document.getElementById('videoContainer');
    const controlsBar = document.querySelector('.controls-bar');
    const sourceBar = document.querySelector('.source-bar');
    const appLayout = document.querySelector('.app-layout');

    // Play / Pause
    playPauseBtn.addEventListener('click', togglePlay);
    rewind10Btn.addEventListener('click', () => seekBy(-10));
    forward10Btn.addEventListener('click', () => seekBy(10));
    videoContainer.addEventListener('click', (e) => {
      // Don't toggle on YT iframe click (YouTube handles it internally)
      if (isYouTube) return;
      if (e.target === video || e.target === videoContainer) togglePlay();
    });

    // Double-click fullscreen
    videoContainer.addEventListener('dblclick', (e) => {
      if (isYouTube && e.target.tagName === 'IFRAME') return;
      toggleFullscreen();
    });

    // Progress bar
    video.addEventListener('timeupdate', () => {
      if (video.duration) {
        const pct = (video.currentTime / video.duration) * 100;
        progressFill.style.width = pct + '%';
        timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
      }
      // Update subtitles
      updateSubtitles();
    });

    progressBar.addEventListener('click', (e) => {
      const rect = progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;

      if (isYouTube && ytPlayer && ytReady) {
        const duration = ytPlayer.getDuration();
        const seekTo = pct * duration;
        ytPlayer.seekTo(seekTo, true);
        emitSync('seek', seekTo);
      } else {
        video.currentTime = pct * video.duration;
        emitSync('seek', video.currentTime);
      }
    });

    // Volume
    volumeSlider.addEventListener('input', () => {
      if (isYouTube && ytPlayer && ytReady) {
        ytPlayer.setVolume(volumeSlider.value * 100);
        if (parseFloat(volumeSlider.value) === 0) ytPlayer.mute();
        else ytPlayer.unMute();
      } else {
        video.volume = volumeSlider.value;
      }
      muteBtn.textContent = volumeSlider.value == 0 ? '🔇' : volumeSlider.value < 0.5 ? '🔉' : '🔊';
    });

    muteBtn.addEventListener('click', () => {
      if (isYouTube && ytPlayer && ytReady) {
        if (ytPlayer.isMuted()) {
          ytPlayer.unMute();
          muteBtn.textContent = '🔊';
        } else {
          ytPlayer.mute();
          muteBtn.textContent = '🔇';
        }
      } else {
        video.muted = !video.muted;
        muteBtn.textContent = video.muted ? '🔇' : '🔊';
      }
    });

    // Speed
    speedSelect.addEventListener('change', () => {
      const rate = parseFloat(speedSelect.value);
      userPlaybackRate = rate;
      if (isYouTube && ytPlayer && ytReady) {
        ytPlayer.setPlaybackRate(rate);
      } else {
        video.playbackRate = rate;
      }
      emitSync('speed', rate);
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', toggleFullscreen);

    // Play state icon (native video)
    video.addEventListener('play', () => {
      playPauseBtn.textContent = '⏸️';
      scheduleControlsAutoHide();
    });
    video.addEventListener('pause', () => {
      playPauseBtn.textContent = '▶️';
      revealFullscreenControls({ keepVisible: true });
    });

    [appLayout, videoContainer, controlsBar, sourceBar].forEach(element => {
      element?.addEventListener('pointermove', () => revealFullscreenControls());
      element?.addEventListener('touchstart', () => revealFullscreenControls(), { passive: true });
    });
    document.addEventListener('fullscreenchange', () => {
      revealFullscreenControls();
      if (!document.fullscreenElement) {
        try {
          screen.orientation?.unlock?.();
        } catch (e) {
          // Orientation unlock is optional.
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      revealFullscreenControls();

      if (isYouTube && ytPlayer && ytReady) {
        handleYTKeyboard(e);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          volumeSlider.value = video.volume;
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          volumeSlider.value = video.volume;
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          video.muted = !video.muted;
          muteBtn.textContent = video.muted ? '🔇' : '🔊';
          break;
      }
    });
  }

  // ===== YouTube keyboard shortcuts =====
  function handleYTKeyboard(e) {
    const volumeSlider = document.getElementById('volumeSlider');
    const muteBtn = document.getElementById('muteBtn');

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        {
          const t = Math.max(0, ytPlayer.getCurrentTime() - 5);
          ytPlayer.seekTo(t, true);
          emitSync('seek', t);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        {
          const t = Math.min(ytPlayer.getDuration(), ytPlayer.getCurrentTime() + 5);
          ytPlayer.seekTo(t, true);
          emitSync('seek', t);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        {
          const vol = Math.min(100, ytPlayer.getVolume() + 10);
          ytPlayer.setVolume(vol);
          ytPlayer.unMute();
          volumeSlider.value = vol / 100;
          muteBtn.textContent = vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊';
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        {
          const vol = Math.max(0, ytPlayer.getVolume() - 10);
          ytPlayer.setVolume(vol);
          volumeSlider.value = vol / 100;
          muteBtn.textContent = vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊';
        }
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'm':
      case 'M':
        if (ytPlayer.isMuted()) { ytPlayer.unMute(); muteBtn.textContent = '🔊'; }
        else { ytPlayer.mute(); muteBtn.textContent = '🔇'; }
        break;
    }
  }

  function togglePlay() {
    revealFullscreenControls();
    if (isYouTube && ytPlayer && ytReady) {
      const state = ytPlayer.getPlayerState();
      const playPauseBtn = document.getElementById('playPauseBtn');
      if (state === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
        playPauseBtn.textContent = '▶️';
        revealFullscreenControls({ keepVisible: true });
        emitSync('pause', ytPlayer.getCurrentTime());
      } else {
        ytPlayer.playVideo();
        playPauseBtn.textContent = '⏸️';
        scheduleControlsAutoHide();
        emitSync('play', ytPlayer.getCurrentTime());
      }
      return;
    }

    if (video.paused) {
      video.play();
      scheduleControlsAutoHide();
      emitSync('play', video.currentTime);
    } else {
      video.pause();
      revealFullscreenControls({ keepVisible: true });
      emitSync('pause', video.currentTime);
    }
  }

  function seekBy(seconds) {
    if (isYouTube && ytPlayer && ytReady) {
      const duration = ytPlayer.getDuration();
      const current = ytPlayer.getCurrentTime();
      const maxTime = Number.isFinite(duration) && duration > 0 ? duration : current + seconds;
      const target = Math.min(maxTime, Math.max(0, current + seconds));
      ytPlayer.seekTo(target, true);
      emitSync('seek', target);
      return;
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime + seconds;
    video.currentTime = Math.min(duration, Math.max(0, video.currentTime + seconds));
    emitSync('seek', video.currentTime);
  }

  function toggleFullscreen() {
    const appLayout = document.querySelector('.app-layout');
    if (!document.fullscreenElement) {
      appLayout.requestFullscreen().then(async () => {
        revealFullscreenControls();
        try {
          await screen.orientation?.lock?.('landscape');
        } catch (e) {
          // Orientation lock is optional and unsupported in some browsers.
        }
      }).catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  function revealFullscreenControls(options = {}) {
    const appLayout = document.querySelector('.app-layout');
    if (!appLayout) return;
    appLayout.classList.remove('controls-hidden');
    if (controlsHideTimer) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
    if (!options.keepVisible) scheduleControlsAutoHide();
  }

  function scheduleControlsAutoHide() {
    const appLayout = document.querySelector('.app-layout');
    if (!appLayout || !document.fullscreenElement) return;
    if (!shouldAutoHideControls()) return;
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    controlsHideTimer = setTimeout(() => {
      if (shouldAutoHideControls()) appLayout.classList.add('controls-hidden');
    }, 2500);
  }

  function shouldAutoHideControls() {
    if (!document.fullscreenElement) return false;
    if (isEmbedFrameActive()) return true;
    return !isPaused();
  }

  function isEmbedFrameActive() {
    const frame = document.getElementById('gdriveFrame');
    return Boolean(frame && frame.style.display !== 'none' && frame.src);
  }

  // ===== YouTube URL Detection =====
  function extractYouTubeId(url) {
    // youtube.com/watch?v=VIDEO_ID
    let match = url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    // youtu.be/VIDEO_ID
    match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    return null;
  }

  // ===== YouTube IFrame API Loading =====
  function loadYouTubeAPI() {
    return new Promise((resolve) => {
      if (ytAPILoaded && window.YT && window.YT.Player) {
        resolve();
        return;
      }

      // Set the global callback
      window.onYouTubeIframeAPIReady = () => {
        ytAPILoaded = true;
        resolve();
      };

      // If script already exists, just wait
      if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        if (window.YT && window.YT.Player) {
          ytAPILoaded = true;
          resolve();
        }
        return;
      }

      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }

  // ===== Create YouTube Player =====
  function createYouTubePlayer(videoId) {
    // Destroy previous YT player if any
    destroyYouTube();

    isYouTube = true;
    ytReady = false;

    // Hide native video, show YouTube container
    video.style.display = 'none';
    const gdriveFrame = document.getElementById('gdriveFrame');
    gdriveFrame.style.display = 'none';

    // Create the YT player div
    let ytDiv = document.getElementById('ytPlayerDiv');
    if (!ytDiv) {
      ytDiv = document.createElement('div');
      ytDiv.id = 'ytPlayerDiv';
      ytDiv.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;z-index:5;';
      document.getElementById('videoContainer').appendChild(ytDiv);
    }

    ytPlayer = new YT.Player('ytPlayerDiv', {
      videoId: videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 0,          // We use our own controls
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,    // No annotations
        disablekb: 1,         // We handle keyboard ourselves
        fs: 0,                // We handle fullscreen
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin
      },
      events: {
        onReady: onYTReady,
        onStateChange: onYTStateChange,
        onPlaybackRateChange: onYTRateChange,
        onError: onYTError
      }
    });
  }

  function onYTReady(event) {
    ytReady = true;
    showToast('YouTube videosu yüklendi! ▶️');

    // Start progress update interval
    startYTProgressUpdate();

    // Set initial volume from slider
    const volumeSlider = document.getElementById('volumeSlider');
    event.target.setVolume(parseFloat(volumeSlider.value) * 100);
  }

  function onYTStateChange(event) {
    const playPauseBtn = document.getElementById('playPauseBtn');
    switch (event.data) {
      case YT.PlayerState.PLAYING:
        playPauseBtn.textContent = '⏸️';
        break;
      case YT.PlayerState.PAUSED:
        playPauseBtn.textContent = '▶️';
        break;
      case YT.PlayerState.ENDED:
        playPauseBtn.textContent = '▶️';
        break;
      case YT.PlayerState.BUFFERING:
        // nothing
        break;
    }
  }

  function onYTRateChange(event) {
    const rate = event.data;
    const speedSelect = document.getElementById('speedSelect');
    if ([...speedSelect.options].some(option => Number(option.value) === rate)) {
      speedSelect.value = rate;
    }
  }

  function onYTError(event) {
    console.error('YouTube Player Error:', event.data);
    const errorMessages = {
      2: 'Geçersiz YouTube video ID!',
      5: 'YouTube video oynatılamıyor (HTML5 hatası).',
      100: 'YouTube video bulunamadı veya kaldırılmış.',
      101: 'Bu video gömülü oynatmaya izin vermiyor.',
      150: 'Bu video gömülü oynatmaya izin vermiyor.'
    };
    showToast(errorMessages[event.data] || 'YouTube oynatma hatası! ❌');
  }

  // ===== YouTube Progress Update =====
  function startYTProgressUpdate() {
    if (ytUpdateInterval) clearInterval(ytUpdateInterval);
    ytUpdateInterval = setInterval(() => {
      if (!ytPlayer || !ytReady) return;

      try {
        const currentTime = ytPlayer.getCurrentTime();
        const duration = ytPlayer.getDuration();
        if (duration > 0) {
          const pct = (currentTime / duration) * 100;
          document.getElementById('progressFill').style.width = pct + '%';
          document.getElementById('timeDisplay').textContent = formatTime(currentTime) + ' / ' + formatTime(duration);
        }

        // Update subtitles (for external subtitles loaded on YT video)
        const subtitleText = document.getElementById('subtitleText');
        if (typeof SubtitleEngine !== 'undefined') {
          const text = SubtitleEngine.getTextAt(currentTime);
          subtitleText.textContent = text;
        }
      } catch (e) {
        // Player might be destroyed
      }
    }, 250);
  }

  function stopYTProgressUpdate() {
    if (ytUpdateInterval) {
      clearInterval(ytUpdateInterval);
      ytUpdateInterval = null;
    }
  }

  // ===== Destroy YouTube Player =====
  function destroyYouTube() {
    stopYTProgressUpdate();
    if (ytPlayer) {
      try { ytPlayer.destroy(); } catch (e) {}
      ytPlayer = null;
    }
    ytReady = false;
    isYouTube = false;

    // Remove the YT div
    const ytDiv = document.getElementById('ytPlayerDiv');
    if (ytDiv) ytDiv.remove();
  }

  /**
   * Extract Google Drive file ID from various URL formats
   */
  function extractGDriveId(url) {
    let match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    match = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    match = url.match(/drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    return null;
  }

  /**
   * Load a video URL (auto-detects MP4, M3U8, Google Drive, YouTube)
   */
  async function loadSource(url) {
    url = normalizeMediaUrl(url);
    // Destroy old HLS
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    isHLS = false;

    // Destroy old YouTube player
    destroyYouTube();

    // Hide iframe, show video
    const gdriveFrame = document.getElementById('gdriveFrame');
    gdriveFrame.style.display = 'none';
    video.style.display = '';

    if (!url) return;

    // YouTube detection
    const ytVideoId = extractYouTubeId(url);
    if (ytVideoId) {
      loadYouTube(ytVideoId);
      return;
    }

    // Google Drive detection
    const gdriveId = extractGDriveId(url);
    if (gdriveId) {
      loadGDrive(gdriveId);
      return;
    }

    if (isSibnetPageUrl(url)) {
      try {
        const resolvedUrl = await resolveSibnetUrl(url);
        if (resolvedUrl && resolvedUrl !== url) {
          loadSource(resolvedUrl);
          return;
        }
      } catch (err) {
        console.error('Sibnet resolve error:', err);
        showToast(err.message || 'Sibnet linki alinamadi');
        embedInIframe(url, 'Sibnet player acilir...');
        return;
      }
    }

    const mediaUrl = getMediaUrlInfo(url);
    const isM3U8 = isHlsUrl(mediaUrl);
    const hlsUrl = isM3U8 ? getPlayableHlsUrl(url) : url;

    // Embed player detection (Abyss.to / Hydrax / custom domains)
    if (!isDirectMediaUrl(mediaUrl) && isEmbedPlayer(url)) {
      embedInIframe(url, 'Video oynatıcı yükleniyor... 🎬');
      return;
    }

    if (isM3U8 && Hls.isSupported()) {
      isHLS = true;
      hlsInstance = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsInstance.loadSource(hlsUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          showToast('HLS yükleme hatası!');
        }
      });
    } else if (isM3U8 && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(() => {});
    } else {
      video.src = url;
      video.play().catch(() => {});
    }
  }

  function normalizeMediaUrl(url) {
    return String(url || '').trim().replace(/&amp;/gi, '&').replace(/&#38;/g, '&');
  }

  function getMediaUrlInfo(url) {
    try {
      const parsed = new URL(url);
      return {
        full: url.toLowerCase(),
        pathname: parsed.pathname.toLowerCase()
      };
    } catch {
      return {
        full: String(url || '').toLowerCase(),
        pathname: String(url || '').split('?')[0].toLowerCase()
      };
    }
  }

  function isHlsUrl(mediaUrl) {
    return mediaUrl.pathname.includes('.m3u8') || mediaUrl.full.includes('m3u8');
  }

  function isDirectMediaUrl(mediaUrl) {
    return isHlsUrl(mediaUrl) || /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi)(?:$|[?#])/i.test(mediaUrl.full);
  }

  function getPlayableHlsUrl(url) {
    try {
      const source = new URL(url, window.location.href);
      if (source.origin === window.location.origin) return source.href;
      if (!/^https?:$/.test(source.protocol)) return url;
      if (!/^https?:$/.test(window.location.protocol)) return url;
      return `/hls?url=${encodeURIComponent(source.href)}`;
    } catch {
      return url;
    }
  }

  function isSibnetPageUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (host !== 'video.sibnet.ru') return false;
      if (isDirectMediaUrl(getMediaUrlInfo(url))) return false;
      return /\/video\d+/i.test(parsed.pathname) || parsed.pathname.endsWith('/shell.php');
    } catch {
      return false;
    }
  }

  async function resolveSibnetUrl(url) {
    showToast('Sibnet linki hazirlanir...');
    const response = await fetch(`/sibnet?url=${encodeURIComponent(url)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) {
      throw new Error(data.error || 'Sibnet linki alinamadi');
    }
    return normalizeMediaUrl(data.url);
  }

  /**
   * Load YouTube video via IFrame API
   */
  function loadYouTube(videoId) {
    showToast('YouTube videosu yükleniyor... 🎬');

    if (ytAPILoaded && window.YT && window.YT.Player) {
      createYouTubePlayer(videoId);
    } else {
      pendingYTVideoId = videoId;
      loadYouTubeAPI().then(() => {
        createYouTubePlayer(videoId);
        pendingYTVideoId = null;
      });
    }
  }

  /**
   * Load Google Drive video via Cloudflare Worker proxy
   */
  const GDRIVE_PROXY = 'https://gdrive-proxy.qsp7mdjbcy.workers.dev';

  function loadGDrive(fileId) {
    const proxyUrl = `${GDRIVE_PROXY}/?id=${fileId}`;
    showToast('Google Drive videosu proxy ile yükleniyor... 📂');
    video.src = proxyUrl;
    video.play().catch(() => {});
  }

  /**
   * Detect if URL is an embed player
   */
  function isEmbedPlayer(url) {
    const mediaUrl = getMediaUrlInfo(url);
    if (isDirectMediaUrl(mediaUrl)) return false;
    if (/abysscdn\.com|playhydrax\.com|abyss\.to/i.test(url)) return true;
    if (/\?v=[a-zA-Z0-9]+/.test(url)) {
      if (/youtube\.com|youtu\.be/.test(url)) return false;
      return true;
    }
    return false;
  }

  /**
   * Generic: embed any URL in the iframe player
   */
  function embedInIframe(embedUrl, toastMsg) {
    const gdriveFrame = document.getElementById('gdriveFrame');
    video.style.display = 'none';
    video.src = '';
    video.pause();
    gdriveFrame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    gdriveFrame.setAttribute('allowfullscreen', '');
    gdriveFrame.src = embedUrl;
    gdriveFrame.style.display = 'block';
    showToast(toastMsg || 'Video yükleniyor... 🎬');
  }

  /**
   * Update subtitle display
   */
  function updateSubtitles() {
    const subtitleText = document.getElementById('subtitleText');
    const text = SubtitleEngine.getTextAt(video.currentTime);
    subtitleText.textContent = text;
  }

  /**
   * Sync: apply remote action
   */
  function applySync(action, time) {
    if (isYouTube && ytPlayer && ytReady) {
      applyYTSync(action, time);
      return;
    }

    if (action === 'speed') {
      userPlaybackRate = time;
      video.playbackRate = time;
      document.getElementById('speedSelect').value = time;
      return;
    }
    if (typeof time === 'number' && isFinite(time)) {
      video.currentTime = time;
    }
    if (action === 'play') video.play().catch(() => {});
    if (action === 'pause') video.pause();
    if (action === 'seek' && typeof time === 'number') video.currentTime = time;
  }

  /**
   * Apply sync action to YouTube player
   */
  function applyYTSync(action, time) {
    const playPauseBtn = document.getElementById('playPauseBtn');

    if (action === 'speed') {
      userPlaybackRate = time;
      ytPlayer.setPlaybackRate(time);
      document.getElementById('speedSelect').value = time;
      return;
    }

    if (action === 'seek' && typeof time === 'number') {
      ytPlayer.seekTo(time, true);
    }

    if (action === 'play') {
      if (typeof time === 'number' && isFinite(time)) {
        ytPlayer.seekTo(time, true);
      }
      ytPlayer.playVideo();
      playPauseBtn.textContent = '⏸️';
      scheduleControlsAutoHide();
    }

    if (action === 'pause') {
      if (typeof time === 'number' && isFinite(time)) {
        ytPlayer.seekTo(time, true);
      }
      ytPlayer.pauseVideo();
      playPauseBtn.textContent = '▶️';
      revealFullscreenControls({ keepVisible: true });
    }
  }

  function setSpeed(rate) {
    userPlaybackRate = rate;
    if (isYouTube && ytPlayer && ytReady) {
      ytPlayer.setPlaybackRate(rate);
    } else {
      video.playbackRate = rate;
    }
    document.getElementById('speedSelect').value = rate;
  }

  function smoothSyncTo(remoteTime, remotePaused, remoteRate, sentAt) {
    if (remotePaused || isPaused()) {
      resetSyncCorrection();
      return;
    }

    const baseRate = Number.isFinite(remoteRate) && remoteRate > 0 ? remoteRate : userPlaybackRate;
    const elapsed = Number.isFinite(sentAt) ? Math.max(0, (Date.now() - sentAt) / 1000) : 0;
    const targetTime = remoteTime + (elapsed * baseRate);
    const localTime = getCurrentTime();
    const drift = targetTime - localTime;
    const absDrift = Math.abs(drift);

    if (!Number.isFinite(targetTime) || absDrift < 0.25) {
      resetSyncCorrection();
      return;
    }

    if (absDrift > 4) {
      applySync('seek', targetTime);
      resetSyncCorrection();
      showSyncStatus('Senkron düzəldildi');
      return;
    }

    const correctionRate = getCorrectionRate(baseRate, drift);
    applyTemporaryRate(correctionRate);
    showSyncStatus('Senkron düzəldilir');

    if (syncCorrectionTimer) clearTimeout(syncCorrectionTimer);
    syncCorrectionTimer = setTimeout(() => {
      const newDrift = targetTime - getCurrentTime();
      if (Math.abs(newDrift) < 0.35) resetSyncCorrection();
    }, 1400);
  }

  function getCorrectionRate(baseRate, drift) {
    if (drift > 1.5) return Math.min(baseRate * 1.08, 3);
    if (drift > 0) return Math.min(baseRate * 1.04, 3);
    if (drift < -1.5) return Math.max(baseRate * 0.92, 0.25);
    return Math.max(baseRate * 0.96, 0.25);
  }

  function applyTemporaryRate(rate) {
    if (isYouTube && ytPlayer && ytReady) {
      const supported = ytPlayer.getAvailablePlaybackRates ? ytPlayer.getAvailablePlaybackRates() : [0.25, 0.5, 1, 1.25, 1.5, 2];
      const sorted = supported.slice().sort((a, b) => a - b);
      if (rate > userPlaybackRate) {
        ytPlayer.setPlaybackRate(sorted.find(item => item > userPlaybackRate) || sorted[sorted.length - 1]);
      } else if (rate < userPlaybackRate) {
        ytPlayer.setPlaybackRate(sorted.slice().reverse().find(item => item < userPlaybackRate) || sorted[0]);
      } else {
        ytPlayer.setPlaybackRate(rate);
      }
      return;
    }

    video.playbackRate = rate;
  }

  function resetSyncCorrection() {
    if (syncCorrectionTimer) {
      clearTimeout(syncCorrectionTimer);
      syncCorrectionTimer = null;
    }

    if (Math.abs(getSpeed() - userPlaybackRate) > 0.01) {
      applyTemporaryRate(userPlaybackRate);
    }
    hideSyncStatusSoon();
  }

  function ensureSyncStatus() {
    if (syncStatusEl) return syncStatusEl;

    syncStatusEl = document.createElement('div');
    syncStatusEl.className = 'sync-status';
    syncStatusEl.setAttribute('aria-live', 'polite');
    document.getElementById('videoContainer').appendChild(syncStatusEl);
    return syncStatusEl;
  }

  function showSyncStatus(message) {
    const el = ensureSyncStatus();
    el.textContent = message;
    el.classList.add('show');
    if (syncStatusTimer) clearTimeout(syncStatusTimer);
  }

  function hideSyncStatusSoon() {
    if (!syncStatusEl) return;
    if (syncStatusTimer) clearTimeout(syncStatusTimer);
    syncStatusTimer = setTimeout(() => {
      syncStatusEl.classList.remove('show');
    }, 1200);
  }

  function getSpeed() {
    if (isYouTube && ytPlayer && ytReady) {
      return ytPlayer.getPlaybackRate();
    }
    return video ? video.playbackRate : 1;
  }

  function emitSync(action, time) {
    if (onSyncCallback) onSyncCallback(action, time);
    window.dispatchEvent(new CustomEvent('cineverse:player-sync', {
      detail: {
        action,
        time,
        isPlaying: action === 'play' ? true : action === 'pause' ? false : !isPaused()
      }
    }));
  }

  function onSync(cb) { onSyncCallback = cb; }

  function getCurrentTime() {
    if (isYouTube && ytPlayer && ytReady) {
      return ytPlayer.getCurrentTime();
    }
    return video ? video.currentTime : 0;
  }

  function getDuration() {
    if (isYouTube && ytPlayer && ytReady) {
      return ytPlayer.getDuration();
    }
    return video ? video.duration : 0;
  }

  function isPaused() {
    if (isYouTube && ytPlayer && ytReady) {
      return ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING;
    }
    return video ? video.paused : true;
  }

  function formatTime(s) {
    if (!isFinite(s)) return '00:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  return { init, loadSource, applySync, onSync, getCurrentTime, getDuration, isPaused, setSpeed, getSpeed, smoothSyncTo };
})();
