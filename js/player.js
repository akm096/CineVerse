/**
 * WatchBuddy — Video Player Controller
 * Supports: MP4 (native), M3U8/HLS (via hls.js)
 */
const PlayerController = (() => {
  let video, hlsInstance;
  let isHLS = false;
  let onSyncCallback = null; // called when user does play/pause/seek

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
      if (e.target === video || e.target === videoContainer) togglePlay();
    });

    // Double-click fullscreen
    videoContainer.addEventListener('dblclick', toggleFullscreen);

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
      video.currentTime = pct * video.duration;
      emitSync('seek', video.currentTime);
    });

    // Volume
    volumeSlider.addEventListener('input', () => {
      video.volume = volumeSlider.value;
      muteBtn.textContent = video.volume == 0 ? '🔇' : video.volume < 0.5 ? '🔉' : '🔊';
    });

    muteBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      muteBtn.textContent = video.muted ? '🔇' : '🔊';
    });

    // Speed
    speedSelect.addEventListener('change', () => {
      video.playbackRate = parseFloat(speedSelect.value);
      emitSync('speed', video.playbackRate);
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', toggleFullscreen);

    // Play state icon
    video.addEventListener('play', () => { playPauseBtn.textContent = '⏸️'; });
    video.addEventListener('pause', () => { playPauseBtn.textContent = '▶️'; });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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

  function togglePlay() {
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

  /**
   * Load a video URL (auto-detects MP4 vs M3U8)
   */
  function loadSource(url) {
    // Destroy old HLS instance
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    isHLS = false;

    if (!url) return;

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
      // Safari native HLS
      video.src = url;
      video.play().catch(() => {});
    } else {
      // Direct MP4 or other
      video.src = url;
      video.play().catch(() => {});
    }
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

  function setSpeed(rate) {
    video.playbackRate = rate;
    document.getElementById('speedSelect').value = rate;
  }

  function getSpeed() { return video ? video.playbackRate : 1; }

  function emitSync(action, time) {
    if (onSyncCallback) onSyncCallback(action, time);
  }

  function onSync(cb) { onSyncCallback = cb; }

  function getCurrentTime() { return video ? video.currentTime : 0; }
  function isPaused() { return video ? video.paused : true; }

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
