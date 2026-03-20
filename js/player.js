/**
 * CineVerse — Video Player Controller
 * Supports: MP4 (native), M3U8/HLS (via hls.js), Google Drive (proxy), YouTube (IFrame API)
 */
const PlayerController = (() => {
  let video, hlsInstance;
  let isHLS = false;
  let onSyncCallback = null; // called when user does play/pause/seek

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
    const videoContainer = document.getElementById('videoContainer');

    // Play / Pause
    playPauseBtn.addEventListener('click', togglePlay);
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
    video.addEventListener('play', () => { playPauseBtn.textContent = '⏸️'; });
    video.addEventListener('pause', () => { playPauseBtn.textContent = '▶️'; });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
          video.currentTime = Math.max(0, video.currentTime - 5);
          emitSync('seek', video.currentTime);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          emitSync('seek', video.currentTime);
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
    if (isYouTube && ytPlayer && ytReady) {
      const state = ytPlayer.getPlayerState();
      const playPauseBtn = document.getElementById('playPauseBtn');
      if (state === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
        playPauseBtn.textContent = '▶️';
        emitSync('pause', ytPlayer.getCurrentTime());
      } else {
        ytPlayer.playVideo();
        playPauseBtn.textContent = '⏸️';
        emitSync('play', ytPlayer.getCurrentTime());
      }
      return;
    }

    if (video.paused) {
      video.play();
      emitSync('play', video.currentTime);
    } else {
      video.pause();
      emitSync('pause', video.currentTime);
    }
  }

  function toggleFullscreen() {
    const appLayout = document.querySelector('.app-layout');
    if (!document.fullscreenElement) {
      appLayout.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
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
    document.getElementById('speedSelect').value = rate;
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
  function loadSource(url) {
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

    // Embed player detection (Abyss.to / Hydrax / custom domains)
    if (isEmbedPlayer(url)) {
      embedInIframe(url, 'Video oynatıcı yükleniyor... 🎬');
      return;
    }

    const isM3U8 = url.includes('.m3u8') || url.includes('m3u8');

    if (isM3U8 && Hls.isSupported()) {
      isHLS = true;
      hlsInstance = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsInstance.loadSource(url);
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
      video.src = url;
      video.play().catch(() => {});
    } else {
      video.src = url;
      video.play().catch(() => {});
    }
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
    }

    if (action === 'pause') {
      if (typeof time === 'number' && isFinite(time)) {
        ytPlayer.seekTo(time, true);
      }
      ytPlayer.pauseVideo();
      playPauseBtn.textContent = '▶️';
    }
  }

  function setSpeed(rate) {
    if (isYouTube && ytPlayer && ytReady) {
      ytPlayer.setPlaybackRate(rate);
    } else {
      video.playbackRate = rate;
    }
    document.getElementById('speedSelect').value = rate;
  }

  function getSpeed() {
    if (isYouTube && ytPlayer && ytReady) {
      return ytPlayer.getPlaybackRate();
    }
    return video ? video.playbackRate : 1;
  }

  function emitSync(action, time) {
    if (onSyncCallback) onSyncCallback(action, time);
  }

  function onSync(cb) { onSyncCallback = cb; }

  function getCurrentTime() {
    if (isYouTube && ytPlayer && ytReady) {
      return ytPlayer.getCurrentTime();
    }
    return video ? video.currentTime : 0;
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

  return { init, loadSource, applySync, onSync, getCurrentTime, isPaused, setSpeed, getSpeed };
})();
