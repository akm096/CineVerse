/**
 * CineVerse — Main Application
 * Room management (PeerJS), theme toggle, subtitle settings, wiring
 * Full bidirectional sync: play/pause/seek/speed/video/subtitles
 */

// ICE Server configuration for WebRTC (STUN + TURN)
// Required for connections across different networks/NATs
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceTransportPolicy: 'all'
};
(() => {
  // ===== State =====
  let username = '';
  let roomId = '';
  let isHost = false;
  let peer = null;
  let connections = [];  // host: array of DataConnection; guest: [hostConn]
  let users = [];        // {name, peerId}
  let syncHeartbeatTimer = null;
  const APP_VERSION = '1.0.0';

  // Room settings (host-controlled)
  let roomSettings = {
    hostOnlyVideo: true,     // only host can change video URL
    hostOnlyPlayback: false, // only host can play/pause/seek
    subtitleMode: 'personal' // personal: each user chooses; shared: host subtitles apply to all
  };
  let localSubtitleMode = roomSettings.subtitleMode;
  let userChangedSubtitleMode = false;

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTabs();
    initSubtitleSettings();
    initSubtitleUpload();
    initVideoSource();
    initRoomSettings();
    initVersionLabel();
    PlayerController.init();
    ChatModule.init();
    showWelcomeModal();
  });

  // ===== Theme =====
  function initTheme() {
    const toggle = document.getElementById('themeToggle');
    const saved = localStorage.getItem('cv-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('cv-theme', next);
    });
  }

  // ===== Sidebar Tabs =====
  function initTabs() {
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });
  }

  // ===== Room Settings =====
  function initRoomSettings() {
    const videoToggle = document.getElementById('hostOnlyVideo');
    const playbackToggle = document.getElementById('hostOnlyPlayback');

    videoToggle.addEventListener('click', () => {
      if (!isHost) { showToast('Sadece host ayarları değiştirebilir'); return; }
      videoToggle.classList.toggle('active');
      roomSettings.hostOnlyVideo = videoToggle.classList.contains('active');
      broadcast({ type: 'settings', settings: roomSettings });
    });

    playbackToggle.addEventListener('click', () => {
      if (!isHost) { showToast('Sadece host ayarları değiştirebilir'); return; }
      playbackToggle.classList.toggle('active');
      roomSettings.hostOnlyPlayback = playbackToggle.classList.contains('active');
      broadcast({ type: 'settings', settings: roomSettings });
    });
  }

  function applyRoomSettings(settings) {
    roomSettings = { ...roomSettings, ...settings };
    const videoToggle = document.getElementById('hostOnlyVideo');
    const playbackToggle = document.getElementById('hostOnlyPlayback');
    videoToggle.classList.toggle('active', roomSettings.hostOnlyVideo);
    playbackToggle.classList.toggle('active', roomSettings.hostOnlyPlayback);
    if (!userChangedSubtitleMode || isHost) {
      setSubtitleMode(roomSettings.subtitleMode, { broadcastChange: false, persistChoice: false });
    }
  }

  function initVersionLabel() {
    const versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  }

  // ===== Welcome Modal =====
  function showWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    const usernameInput = document.getElementById('usernameInput');
    const joinRoomInput = document.getElementById('joinRoomInput');
    const joinRoomField = document.getElementById('joinRoomField');
    const createBtn = document.getElementById('createRoomBtn');
    const joinBtn = document.getElementById('joinRoomBtn');

    modal.classList.add('open');

    // Check URL for room code
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const joinParam = params.get('join');

    if (roomParam) {
      joinRoomField.style.display = 'block';
      joinRoomInput.value = roomParam;
      createBtn.style.display = 'none';
    }
    if (joinParam === 'true') {
      joinRoomField.style.display = 'block';
    }

    // Restore saved username
    const savedName = localStorage.getItem('cv-username');
    if (savedName) usernameInput.value = savedName;

    createBtn.addEventListener('click', () => {
      const name = usernameInput.value.trim();
      if (!name) { usernameInput.focus(); return; }
      username = name;
      localStorage.setItem('cv-username', name);
      modal.classList.remove('open');
      document.getElementById('currentUser').textContent = '👤 ' + name;
      startAsHost();
    });

    joinBtn.addEventListener('click', () => {
      if (joinRoomField.style.display === 'none') {
        joinRoomField.style.display = 'block';
        joinRoomInput.focus();
        return;
      }
      const name = usernameInput.value.trim();
      const code = joinRoomInput.value.trim();
      if (!name) { usernameInput.focus(); return; }
      if (!code) { joinRoomInput.focus(); return; }
      username = name;
      localStorage.setItem('cv-username', name);
      modal.classList.remove('open');
      document.getElementById('currentUser').textContent = '👤 ' + name;
      joinRoom(code);
    });
  }

  // ===== PeerJS Room =====
  function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'cv-';
    for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function startAsHost() {
    isHost = true;
    stopSyncHeartbeat();
    roomId = generateRoomId();
    users = [{ name: username, peerId: roomId }];

    peer = new Peer(roomId, { config: ICE_SERVERS, debug: 1 });

    peer.on('open', (id) => {
      roomId = id;
      updateRoomUI();
      ChatModule.displayMessage('', `${username} odayı oluşturdu`, true);
      updateUserList();
      startSyncHeartbeat();
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        connections.push(conn);
        conn.on('data', (data) => handleHostData(conn, data));
        conn.on('close', () => {
          connections = connections.filter(c => c !== conn);
          users = users.filter(u => u.peerId !== conn.peer);
          updateUserList();
          broadcast({ type: 'users', users });
          ChatModule.displayMessage('', `Bir kullanıcı ayrıldı`, true);
        });
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'unavailable-id') {
        roomId = generateRoomId();
        peer.destroy();
        startAsHost();
      }
    });

    // HOST: player actions → broadcast to ALL guests
    PlayerController.onSync((action, time) => {
      broadcast({ type: 'sync', action, time });
    });

    // Chat send
    ChatModule.onSend((text, reply, messageId) => {
      ChatModule.displayMessage(username, text, false, false, null, reply, true, messageId);
      broadcast({ type: 'chat', name: username, text, reply, messageId });
    });

    ChatModule.onImageSend((image, reply, messageId) => {
      ChatModule.displayMessage(username, '', false, false, image, reply, true, messageId);
      broadcast({ type: 'chat-image', name: username, image, reply, messageId });
    });

    ChatModule.onTyping((isTyping) => {
      broadcast({ type: 'typing', name: username, isTyping });
    });

    ChatModule.onReaction((messageId, emoji) => {
      broadcast({ type: 'chat-reaction', messageId, emoji });
    });

    ChatModule.onEdit((messageId, text) => {
      broadcast({ type: 'chat-edit', messageId, text });
    });
  }

  /**
   * HOST handles data from a guest
   */
  function handleHostData(conn, data) {
    if (data.type === 'join') {
      const user = { name: data.name, peerId: conn.peer };
      users.push(user);
      updateUserList();
      // Send full state to new user
      conn.send({
        type: 'init',
        users,
        videoUrl: document.getElementById('videoUrlInput').value,
        currentTime: PlayerController.getCurrentTime(),
        paused: PlayerController.isPaused(),
        speed: PlayerController.getSpeed(),
        settings: roomSettings,
        subtitleData: localSubtitleMode === 'shared' && lastSubtitleText
          ? { text: lastSubtitleText, filename: lastSubtitleFilename }
          : null
      });
      broadcast({ type: 'users', users });
      ChatModule.displayMessage('', `${data.name} odaya katıldı`, true);
      broadcast({ type: 'chat', name: '', text: `${data.name} odaya katıldı`, system: true });
    }

    // Guest requests a sync action (play/pause/seek/speed/video)
    if (data.type === 'guest-sync') {
      const action = data.action;
      const time = data.time;

      // Check permissions
      if (action === 'video' && roomSettings.hostOnlyVideo) {
        conn.send({ type: 'toast', msg: 'Sadece host video değiştirebilir! 🔒' });
        return;
      }
      if (['play', 'pause', 'seek'].includes(action) && roomSettings.hostOnlyPlayback) {
        conn.send({ type: 'toast', msg: 'Sadece host oynatmayı kontrol edebilir! 🔒' });
        return;
      }

      // Apply action locally on host
      if (action === 'video') {
        document.getElementById('videoUrlInput').value = data.url;
        PlayerController.loadSource(data.url);
        broadcast({ type: 'video', url: data.url });
      } else {
        PlayerController.applySync(action, time);
        // Relay to ALL guests (including sender — they already applied locally)
        connections.forEach(c => {
          if (c !== conn && c.open) c.send({ type: 'sync', action, time });
        });
      }
    }

    // Guest chat
    if (data.type === 'chat') {
      ChatModule.displayMessage(data.name, data.text, false, true, null, data.reply, false, data.messageId);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'chat-image') {
      ChatModule.displayMessage(data.name, '', false, true, data.image, data.reply, false, data.messageId);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'typing') {
      ChatModule.setTyping(data.name, data.isTyping);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'chat-reaction') {
      ChatModule.applyReaction(data.messageId, data.emoji);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'chat-edit') {
      ChatModule.applyEdit(data.messageId, data.text);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    // Guest loaded subtitle (not used — only host sends subtitles)
  }

  let joinRetryCount = 0;
  const MAX_JOIN_RETRIES = 2;

  function joinRoom(hostId) {
    isHost = false;
    stopSyncHeartbeat();
    roomId = hostId;

    showToast('Odaya bağlanılıyor... ⏳');

    peer = new Peer(undefined, { config: ICE_SERVERS, debug: 1 });

    peer.on('open', () => {
      console.log('PeerJS connected, my id:', peer.id);
      connectToHost(hostId);
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'peer-unavailable') {
        showToast('Oda bulunamadı! Oda kodu yanlış veya host çevrimdışı. ❌');
      } else if (err.type === 'network') {
        showToast('Ağ hatası! İnternet bağlantınızı kontrol edin. ❌');
      } else if (err.type === 'server-error') {
        showToast('Sunucu hatası! Biraz bekleyip tekrar deneyin. ❌');
      } else {
        showToast('Bağlantı hatası: ' + (err.type || err.message) + ' ❌');
      }
    });

    // GUEST: player actions → send to HOST as guest-sync
    PlayerController.onSync((action, time) => {
      if (connections[0] && connections[0].open) {
        connections[0].send({ type: 'guest-sync', action, time });
      }
    });

    // Chat send
    ChatModule.onSend((text, reply, messageId) => {
      ChatModule.displayMessage(username, text, false, false, null, reply, true, messageId);
      if (connections[0] && connections[0].open) {
        connections[0].send({ type: 'chat', name: username, text, reply, messageId });
      }
    });

    ChatModule.onImageSend((image, reply, messageId) => {
      ChatModule.displayMessage(username, '', false, false, image, reply, true, messageId);
      if (connections[0] && connections[0].open) {
        connections[0].send({ type: 'chat-image', name: username, image, reply, messageId });
      }
    });

    ChatModule.onTyping((isTyping) => {
      if (connections[0] && connections[0].open) {
        connections[0].send({ type: 'typing', name: username, isTyping });
      }
    });

    ChatModule.onReaction((messageId, emoji) => {
      if (connections[0] && connections[0].open) {
        connections[0].send({ type: 'chat-reaction', messageId, emoji });
      }
    });

    ChatModule.onEdit((messageId, text) => {
      if (connections[0] && connections[0].open) {
        connections[0].send({ type: 'chat-edit', messageId, text });
      }
    });
  }

  function connectToHost(hostId) {
    const conn = peer.connect(hostId, { reliable: true });
    connections = [conn];

    // Connection timeout — if not connected in 15s, retry
    const connTimeout = setTimeout(() => {
      if (!conn.open) {
        console.warn('Connection timeout, attempt', joinRetryCount + 1);
        conn.close();
        if (joinRetryCount < MAX_JOIN_RETRIES) {
          joinRetryCount++;
          showToast(`Bağlantı zaman aşımı, tekrar deneniyor (${joinRetryCount}/${MAX_JOIN_RETRIES})... ⏳`);
          connectToHost(hostId);
        } else {
          showToast('Odaya bağlanılamadı! Host çevrimdışı olabilir veya ağ engelliyor. ❌');
          joinRetryCount = 0;
        }
      }
    }, 15000);

    conn.on('open', () => {
      clearTimeout(connTimeout);
      joinRetryCount = 0;
      console.log('Connected to host!');
      showToast('Odaya bağlandı! ✅');
      conn.send({ type: 'join', name: username });
      updateRoomUI();
    });

    conn.on('data', (data) => {
      if (data.type === 'init') {
        users = data.users;
        updateUserList();
        if (data.settings) applyRoomSettings(data.settings);
        if (data.speed) PlayerController.setSpeed(data.speed);
        if (data.subtitleData && shouldApplySharedSubtitles()) {
          applySharedSubtitle(data.subtitleData);
        }
        if (data.videoUrl) {
          document.getElementById('videoUrlInput').value = data.videoUrl;
          PlayerController.loadSource(data.videoUrl);
          // YouTube needs more time to load — retry sync until ready
          const isYT = /youtube\.com|youtu\.be/.test(data.videoUrl);
          const syncDelay = isYT ? 3000 : 1000;
          const syncAction = data.paused ? 'pause' : 'play';
          setTimeout(() => {
            PlayerController.applySync(syncAction, data.currentTime);
          }, syncDelay);
          // For YouTube: retry once more after 5s in case first attempt was too early
          if (isYT) {
            setTimeout(() => {
              PlayerController.applySync(syncAction, data.currentTime);
            }, 6000);
          }
        }
      }
      if (data.type === 'users') {
        users = data.users;
        updateUserList();
      }
      if (data.type === 'sync') {
        PlayerController.applySync(data.action, data.time);
      }
      if (data.type === 'sync-state') {
        PlayerController.smoothSyncTo(data.time, data.paused, data.speed, data.sentAt);
      }
      if (data.type === 'chat') {
        ChatModule.displayMessage(data.name, data.text, data.system, true, null, data.reply, false, data.messageId);
      }
      if (data.type === 'chat-image') {
        ChatModule.displayMessage(data.name, '', false, true, data.image, data.reply, false, data.messageId);
      }
      if (data.type === 'typing') {
        ChatModule.setTyping(data.name, data.isTyping);
      }
      if (data.type === 'chat-reaction') {
        ChatModule.applyReaction(data.messageId, data.emoji);
      }
      if (data.type === 'chat-edit') {
        ChatModule.applyEdit(data.messageId, data.text);
      }
      if (data.type === 'video') {
        document.getElementById('videoUrlInput').value = data.url;
        PlayerController.loadSource(data.url);
      }
      if (data.type === 'settings') {
        applyRoomSettings(data.settings);
      }
      if (data.type === 'subtitle-data') {
        if (!shouldApplySharedSubtitles()) return;
        // Host shared subtitles
        const count = SubtitleEngine.load(data.text, data.filename);
        document.getElementById('subtitleFileName').textContent = `✅ ${data.filename} (${count} satır) — Host tarafından`;
        showToast(`Host altyazı paylaştı: ${count} satır 📝`);
      }
      if (data.type === 'subtitle-clear') {
        if (!shouldApplySharedSubtitles()) return;
        SubtitleEngine.clear();
        document.getElementById('subtitleText').textContent = '';
        document.getElementById('subtitleFileName').textContent = '';
        showToast('Host altyazıyı temizledi');
      }
      if (data.type === 'toast') {
        showToast(data.msg);
      }
    });

    conn.on('close', () => {
      ChatModule.displayMessage('', 'Bağlantı koptu! Yeniden bağlanılıyor...', true);
      showToast('Bağlantı koptu! Yeniden deneniyor... ⏳');
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (peer && !peer.destroyed) {
          joinRetryCount = 0;
          connectToHost(hostId);
        }
      }, 3000);
    });
  }



  function broadcast(data) {
    connections.forEach(conn => {
      if (conn.open) conn.send(data);
    });
  }

  function startSyncHeartbeat() {
    stopSyncHeartbeat();
    syncHeartbeatTimer = setInterval(() => {
      if (!isHost || PlayerController.isPaused()) return;

      broadcast({
        type: 'sync-state',
        time: PlayerController.getCurrentTime(),
        paused: PlayerController.isPaused(),
        speed: PlayerController.getSpeed(),
        sentAt: Date.now()
      });
    }, 1500);
  }

  function stopSyncHeartbeat() {
    if (syncHeartbeatTimer) {
      clearInterval(syncHeartbeatTimer);
      syncHeartbeatTimer = null;
    }
  }

  function updateRoomUI() {
    const roomLink = window.location.origin + window.location.pathname + '?room=' + roomId;
    document.getElementById('roomLinkInput').value = roomLink;

    document.getElementById('copyLinkBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(roomLink).then(() => {
        showToast('Bağlantı kopyalandı! 📋');
      }).catch(() => {
        const input = document.getElementById('roomLinkInput');
        input.select();
        document.execCommand('copy');
        showToast('Bağlantı kopyalandı! 📋');
      });
    });
  }

  function updateUserList() {
    const list = document.getElementById('userList');
    list.innerHTML = '';
    users.forEach((u, i) => {
      const li = document.createElement('li');
      const initial = u.name.charAt(0).toUpperCase();
      li.innerHTML = `
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${escapeHTML(u.name)}</span>
        ${i === 0 ? '<span class="user-badge">Host</span>' : ''}
      `;
      list.appendChild(li);
    });
  }

  // ===== Video Source =====
  function initVideoSource() {
    const loadBtn = document.getElementById('loadVideoBtn');
    const urlInput = document.getElementById('videoUrlInput');

    loadBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;

      if (isHost) {
        // Host: load locally + broadcast to all
        PlayerController.loadSource(url);
        broadcast({ type: 'video', url });
        showToast('Video yükleniyor... 🎬');
      } else {
        // Guest: request from host
        if (connections[0] && connections[0].open) {
          connections[0].send({ type: 'guest-sync', action: 'video', url });
        }
        showToast('Video değiştirme isteği gönderildi...');
      }
    });

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadBtn.click();
    });
  }

  // ===== Subtitle Upload =====
  // Track last loaded subtitle text for sharing
  let lastSubtitleText = '';
  let lastSubtitleFilename = '';

  function initSubtitleUpload() {
    const uploadArea = document.getElementById('subtitleUpload');
    const fileInput = document.getElementById('subtitleFileInput');
    const fileName = document.getElementById('subtitleFileName');
    const loadUrlBtn = document.getElementById('loadSubUrlBtn');
    const subUrlInput = document.getElementById('subtitleUrlInput');
    const clearBtn = document.getElementById('clearSubBtn');

    subUrlInput.placeholder = 'Altyazi URL veya GitHub raw/blob linki yapistir (.srt, .vtt, .json)';

    uploadArea.addEventListener('click', () => fileInput.click());

    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files.length) loadSubtitleFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) loadSubtitleFile(fileInput.files[0]);
    });

    loadUrlBtn.addEventListener('click', () => {
      const url = subUrlInput.value.trim();
      if (!url) return;
      loadSubtitleFromURL(url);
    });

    clearBtn.addEventListener('click', () => {
      SubtitleEngine.clear();
      document.getElementById('subtitleText').textContent = '';
      fileName.textContent = '';
      lastSubtitleText = '';
      lastSubtitleFilename = '';
      showToast('Altyazı temizlendi');
      // If host is using shared mode, broadcast clear to all.
      if (isHost && localSubtitleMode === 'shared') {
        broadcast({ type: 'subtitle-clear' });
      }
    });
  }

  function loadSubtitleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = decodeSubtitleBuffer(e.target.result);
      const count = SubtitleEngine.load(text, file.name);
      document.getElementById('subtitleFileName').textContent = `✅ ${file.name} (${count} satır)`;
      showToast(`Altyazı yüklendi: ${count} satır 📝`);

      // If host is using shared mode, share subtitle data to all guests.
      lastSubtitleText = text;
      lastSubtitleFilename = file.name;
      if (isHost && localSubtitleMode === 'shared') {
        broadcast({ type: 'subtitle-data', text, filename: file.name });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function loadSubtitleFromURL(url) {
    showToast('Altyazı indiriliyor...');
    const subtitleUrl = normalizeSubtitleUrl(url);

    fetch(subtitleUrl)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(buffer => {
        const text = decodeSubtitleBuffer(buffer);
        const filename = getSubtitleFilename(url, subtitleUrl);
        const count = SubtitleEngine.load(text, filename);
        document.getElementById('subtitleFileName').textContent = `✅ ${filename} (${count} satır)`;
        showToast(`Altyazı yüklendi: ${count} satır 📝`);

        // If host is using shared mode, share subtitle data.
        lastSubtitleText = text;
        lastSubtitleFilename = filename;
        if (isHost && localSubtitleMode === 'shared') {
          broadcast({ type: 'subtitle-data', text, filename });
        }
      })
      .catch(err => {
        console.error('Subtitle URL error:', err);
        showToast('Altyazı yüklenemedi! ❌');
      });
  }

  function normalizeSubtitleUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'github.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const blobIndex = parts.indexOf('blob');
        const rawIndex = parts.indexOf('raw');
        const fileIndex = blobIndex === 2 ? blobIndex : rawIndex;
        if (parts.length >= 5 && fileIndex === 2) {
          const owner = parts[0];
          const repo = parts[1];
          const branch = parts[3];
          const path = parts.slice(4).join('/');
          return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
        }
      }

      if (parsed.hostname === 'raw.github.com') {
        parsed.hostname = 'raw.githubusercontent.com';
        return parsed.toString();
      }
    } catch (err) {
      // Fetch will show the original URL error.
    }

    return url;
  }

  function getSubtitleFilename(originalUrl, loadedUrl) {
    try {
      const originalPath = new URL(originalUrl).pathname;
      const parts = originalPath.split('/').filter(Boolean);
      const blobIndex = parts.indexOf('blob');
      const filename = blobIndex === 2 ? parts.slice(4).pop() : parts.pop();
      if (filename) return decodeURIComponent(filename);
    } catch (err) {
      // Fallback below.
    }

    return loadedUrl.split('/').pop().split('?')[0] || 'subtitle.srt';
  }

  function decodeSubtitleBuffer(buffer) {
    const candidates = ['utf-8', 'windows-1254', 'iso-8859-9', 'windows-1252'];
    let bestText = '';
    let bestScore = Infinity;

    candidates.forEach(encoding => {
      try {
        const text = new TextDecoder(encoding).decode(buffer).replace(/^\uFEFF/, '');
        const score = getDecodeProblemScore(text);
        if (score < bestScore) {
          bestScore = score;
          bestText = text;
        }
      } catch (err) {
        // Some older browsers may not support every legacy label.
      }
    });

    return bestText || new TextDecoder().decode(buffer).replace(/^\uFEFF/, '');
  }

  function getDecodeProblemScore(text) {
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const mojibakeCount = (text.match(/(?:Ã.|Ä.|Å.|Â.|ğŸ)/g) || []).length;
    const turkishCount = (text.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
    return (replacementCount * 20) + (mojibakeCount * 3) - turkishCount;
  }

  function setSubtitleMode(mode, options = {}) {
    const nextMode = mode === 'shared' ? 'shared' : 'personal';
    localSubtitleMode = nextMode;

    const subtitleSyncMode = document.getElementById('subtitleSyncMode');
    if (subtitleSyncMode) subtitleSyncMode.value = nextMode;

    if (options.persistChoice) {
      localStorage.setItem('cv-subtitle-mode', nextMode);
    }

    if (isHost) {
      roomSettings.subtitleMode = nextMode;
      if (options.broadcastChange) {
        broadcast({ type: 'settings', settings: roomSettings });
        if (nextMode === 'shared' && lastSubtitleText) {
          broadcast({ type: 'subtitle-data', text: lastSubtitleText, filename: lastSubtitleFilename });
        }
      }
    }
  }

  function shouldApplySharedSubtitles() {
    return localSubtitleMode === 'shared';
  }

  function applySharedSubtitle(data) {
    const count = SubtitleEngine.load(data.text, data.filename);
    document.getElementById('subtitleFileName').textContent = `OK ${data.filename} (${count} satir) - Host`;
    showToast(`Host altyazi paylasti: ${count} satir`);
  }

  // ===== Subtitle Settings =====
  function initSubtitleSettings() {
    const subtitleText = document.getElementById('subtitleText');
    const subtitleOverlay = document.getElementById('subtitleOverlay');
    const subtitleSyncMode = document.getElementById('subtitleSyncMode');
    const savedSubtitleMode = localStorage.getItem('cv-subtitle-mode') || roomSettings.subtitleMode;
    userChangedSubtitleMode = Boolean(localStorage.getItem('cv-subtitle-mode'));

    setSubtitleMode(savedSubtitleMode, { broadcastChange: false, persistChoice: false });
    if (subtitleSyncMode) {
      subtitleSyncMode.addEventListener('change', (e) => {
        userChangedSubtitleMode = true;
        setSubtitleMode(e.target.value, { broadcastChange: isHost, persistChoice: true });
        showToast(e.target.value === 'shared'
          ? 'Altyazi modu: host ile ortak'
          : 'Altyazi modu: kisiye ozel');
      });
    }

    document.getElementById('subFontSize').addEventListener('input', (e) => {
      subtitleText.style.fontSize = e.target.value + 'px';
    });

    document.getElementById('subFontColor').addEventListener('input', (e) => {
      subtitleText.style.color = e.target.value;
    });

    const bgToggle = document.getElementById('subBgToggle');
    bgToggle.addEventListener('click', () => {
      bgToggle.classList.toggle('active');
      updateSubtitleBg();
    });

    document.getElementById('subBgColor').addEventListener('input', updateSubtitleBg);
    document.getElementById('subBgOpacity').addEventListener('input', updateSubtitleBg);

    document.getElementById('subPosition').addEventListener('change', (e) => {
      if (e.target.value === 'top') {
        subtitleOverlay.style.top = '80px';
        subtitleOverlay.style.bottom = 'auto';
      } else {
        subtitleOverlay.style.top = 'auto';
        subtitleOverlay.style.bottom = '80px';
      }
    });

    function updateSubtitleBg() {
      const isOn = bgToggle.classList.contains('active');
      if (!isOn) {
        subtitleText.style.background = 'transparent';
        subtitleText.style.textShadow = '2px 2px 4px rgba(0,0,0,.9)';
        return;
      }
      const color = document.getElementById('subBgColor').value;
      const opacity = document.getElementById('subBgOpacity').value / 100;
      const r = parseInt(color.substr(1, 2), 16);
      const g = parseInt(color.substr(3, 2), 16);
      const b = parseInt(color.substr(5, 2), 16);
      subtitleText.style.background = `rgba(${r},${g},${b},${opacity})`;
      subtitleText.style.textShadow = 'none';
    }
  }

  // ===== Toast =====
  window.showToast = function(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  };

  // ===== Util =====
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
