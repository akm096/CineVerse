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
  let roomRegistryTimer = null;
  let activeRoomsTimer = null;
  let roomHostToken = '';
  let intentionalRoomExit = false;
  const bannedRoomUsers = new Set();
  let bannedRoomList = [];
  let roomDetails = { name: '', description: '' };
  let currentRoomContent = null; // Persistent library content loaded in this room, if any.
  const APP_VERSION = '1.3.7';

  // Room settings (host-controlled)
  let roomSettings = {
    hostOnlyVideo: true,     // only host can change video URL
    hostOnlyPlayback: false, // only host can play/pause/seek
    subtitleMode: 'personal', // personal: each user chooses; shared: host subtitles apply to all
    visibility: 'private'
  };
  let localSubtitleMode = roomSettings.subtitleMode;
  let userChangedSubtitleMode = false;

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTabs();
    initMobileInterface();
    initSubtitleSettings();
    initSubtitleUpload();
    initVideoSource();
    initRoomSettings();
    initVersionLabel();
    PlayerController.init();
    ChatModule.init();
    initRoomEntry();
    initRoomActions();
    initActiveRooms();
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
    const visibilityToggle = document.getElementById('roomVisibilityToggle');
    const saveRoomDetailsBtn = document.getElementById('saveRoomDetailsBtn');

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

    visibilityToggle?.addEventListener('click', () => {
      if (!isHost) { showToast('Sadece host ayarları değiştirebilir'); return; }
      visibilityToggle.classList.toggle('active');
      roomSettings.visibility = visibilityToggle.classList.contains('active') ? 'public' : 'private';
      broadcast({ type: 'settings', settings: roomSettings });
      syncRoomRegistry({ immediate: true });
      showToast(roomSettings.visibility === 'public'
        ? 'Oda aktiv odalarda gorunur'
        : 'Oda private edildi');
    });

    saveRoomDetailsBtn?.addEventListener('click', () => {
      if (!isHost) { showToast('Sadece host ayarları değiştirebilir'); return; }
      roomDetails = readRoomDetailsInputs();
      syncRoomRegistry({ immediate: true });
      broadcast({ type: 'room-details', details: roomDetails });
      showToast('Oda bilgisi guncellendi');
    });
  }

  function initMobileInterface() {
    const appLayout = document.querySelector('.app-layout');
    const moreBtn = document.getElementById('mobileMoreBtn');
    const moreMenu = document.getElementById('mobileMoreMenu');
    const sourceBar = document.querySelector('.source-bar');
    const chatToggle = document.getElementById('fullscreenChatToggle');
    const chatClose = document.getElementById('fullscreenChatCloseBtn');
    const settingsBtn = document.getElementById('fullscreenChatSettingsBtn');
    const settingsPanel = document.getElementById('fullscreenChatSettings');
    const modeSelect = document.getElementById('fullscreenChatMode');
    const widthInput = document.getElementById('fullscreenChatWidth');
    const fontInput = document.getElementById('fullscreenChatFont');
    const widthValue = document.getElementById('fullscreenChatWidthValue');
    const fontValue = document.getElementById('fullscreenChatFontValue');
    const badge = document.getElementById('fullscreenChatBadge');
    const storageKey = 'cv-fullscreen-chat-settings';
    let unreadCount = 0;

    const saved = readStoredChatSettings(storageKey);
    modeSelect.value = saved.mode;
    widthInput.value = String(saved.width);
    fontInput.value = String(saved.font);

    function applyChatSettings() {
      const width = Math.min(70, Math.max(25, Number(widthInput.value) || 40));
      const font = Math.min(150, Math.max(80, Number(fontInput.value) || 100));
      const mode = modeSelect.value === 'side' ? 'side' : 'overlay';
      appLayout.style.setProperty('--fullscreen-chat-width', `${width}%`);
      appLayout.style.setProperty('--fullscreen-chat-font-scale', String(font / 100));
      appLayout.classList.toggle('fullscreen-chat-side', mode === 'side');
      widthValue.textContent = `${width}%`;
      fontValue.textContent = `${font}%`;
      localStorage.setItem(storageKey, JSON.stringify({ mode, width, font }));
    }

    function setMoreMenu(open) {
      moreMenu.hidden = !open;
      moreBtn.setAttribute('aria-expanded', String(open));
      moreBtn.classList.toggle('active', open);
    }

    function clearUnread() {
      unreadCount = 0;
      badge.textContent = '0';
      badge.hidden = true;
    }

    function setFullscreenChat(open) {
      appLayout.classList.toggle('fullscreen-chat-open', open);
      chatToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        selectTab('chat');
        clearUnread();
        requestAnimationFrame(() => {
          const messages = document.getElementById('chatMessages');
          if (messages) messages.scrollTop = messages.scrollHeight;
        });
      } else {
        settingsPanel.hidden = true;
      }
    }

    moreBtn?.addEventListener('click', event => {
      event.stopPropagation();
      setMoreMenu(moreMenu.hidden);
    });

    moreMenu?.addEventListener('click', event => {
      const tabButton = event.target.closest('[data-mobile-tab]');
      if (tabButton) {
        selectTab(tabButton.dataset.mobileTab);
        setMoreMenu(false);
        moreBtn.classList.add('active');
        return;
      }
      if (event.target.closest('[data-mobile-source]')) {
        sourceBar.classList.toggle('mobile-source-open');
        setMoreMenu(false);
        moreBtn.classList.add('active');
        if (sourceBar.classList.contains('mobile-source-open')) {
          document.getElementById('videoUrlInput')?.focus();
        }
      }
    });

    document.addEventListener('click', event => {
      if (!moreMenu?.hidden && !moreMenu.contains(event.target) && event.target !== moreBtn) {
        setMoreMenu(false);
      }
    });

    chatToggle?.addEventListener('click', () => {
      setFullscreenChat(!appLayout.classList.contains('fullscreen-chat-open'));
    });
    chatClose?.addEventListener('click', () => {
      if (document.fullscreenElement) {
        setFullscreenChat(false);
      } else {
        // Mobile non-fullscreen: switch to room tab
        selectTab('room');
      }
    });
    settingsBtn?.addEventListener('click', () => {
      settingsPanel.hidden = !settingsPanel.hidden;
    });
    [modeSelect, widthInput, fontInput].forEach(control => {
      control?.addEventListener('input', applyChatSettings);
      control?.addEventListener('change', applyChatSettings);
    });

    window.addEventListener('cineverse:chat-incoming', () => {
      if (!document.fullscreenElement || appLayout.classList.contains('fullscreen-chat-open')) return;
      unreadCount += 1;
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.hidden = false;
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        setFullscreenChat(false);
        clearUnread();
      }
    });

    const updateViewportHeight = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--cv-viewport-height', `${Math.round(height)}px`);
    };
    updateViewportHeight();
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);

    applyChatSettings();

    const adminTab = document.getElementById('adminTabBtn');
    const mobileAdmin = document.getElementById('mobileAdminMenuBtn');
    if (adminTab && mobileAdmin) {
      new MutationObserver(() => {
        mobileAdmin.hidden = adminTab.hidden;
      }).observe(adminTab, { attributes: true, attributeFilter: ['hidden'] });
      mobileAdmin.hidden = adminTab.hidden;
    }

    const bannedTab = document.getElementById('bannedTabBtn');
    const mobileBanned = document.getElementById('mobileBannedMenuBtn');
    if (bannedTab && mobileBanned) {
      new MutationObserver(() => {
        mobileBanned.hidden = bannedTab.hidden;
      }).observe(bannedTab, { attributes: true, attributeFilter: ['hidden'] });
      mobileBanned.hidden = bannedTab.hidden;
    }
  }

  function readStoredChatSettings(storageKey) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        mode: value.mode === 'side' ? 'side' : 'overlay',
        width: Math.min(70, Math.max(25, Number(value.width) || 40)),
        font: Math.min(150, Math.max(80, Number(value.font) || 100))
      };
    } catch {
      return { mode: 'overlay', width: 40, font: 100 };
    }
  }

  function applyRoomSettings(settings) {
    roomSettings = { ...roomSettings, ...settings };
    const videoToggle = document.getElementById('hostOnlyVideo');
    const playbackToggle = document.getElementById('hostOnlyPlayback');
    const visibilityToggle = document.getElementById('roomVisibilityToggle');
    videoToggle.classList.toggle('active', roomSettings.hostOnlyVideo);
    playbackToggle.classList.toggle('active', roomSettings.hostOnlyPlayback);
    visibilityToggle?.classList.toggle('active', roomSettings.visibility === 'public');
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

  // ===== Room Entry =====
  let roomModalBound = false;

  function initRoomEntry() {
    bindRoomModal();
    document.getElementById('openRoomBtn')?.addEventListener('click', () => openRoomModal({ force: true }));
    document.getElementById('roomStartBtn')?.addEventListener('click', () => openRoomModal({ force: true }));
    window.addEventListener('cineverse:auth-change', event => handleAuthChange(event.detail?.user || null));
  }

  function handleAuthChange(accountUser) {
    const params = new URLSearchParams(window.location.search);
    const createRoomIntent = params.get('createRoom') === '1';
    const hasRoomIntent = Boolean(params.get('room')) || params.get('join') === 'true' || createRoomIntent;

    if (accountUser) {
      username = accountUser.username;
      localStorage.setItem('cv-username', username);
      document.getElementById('currentUser').textContent = 'User: ' + username;
      if (createRoomIntent && !roomId) {
        closeRoomModal();
        startAsHost();
      } else if (hasRoomIntent && !roomId) {
        openRoomModal({ mode: 'join', force: true });
      } else if (!roomId) {
        closeRoomModal();
      }
      return;
    }

    if (!roomId) {
      openRoomModal({ mode: hasRoomIntent ? 'join' : 'choose', force: true });
    }
  }

  function bindRoomModal() {
    if (roomModalBound) return;
    roomModalBound = true;

    const usernameInput = document.getElementById('usernameInput');
    const joinRoomInput = document.getElementById('joinRoomInput');
    const joinRoomField = document.getElementById('joinRoomField');
    const createBtn = document.getElementById('createRoomBtn');
    const joinBtn = document.getElementById('joinRoomBtn');

    createBtn.addEventListener('click', () => {
      const name = getRoomUsername();
      if (!name) { usernameInput.focus(); return; }
      username = name;
      persistRoomUsername(name);
      closeRoomModal();
      document.getElementById('currentUser').textContent = 'User: ' + name;
      startAsHost();
    });

    joinBtn.addEventListener('click', () => {
      if (joinRoomField.style.display === 'none') {
        joinRoomField.style.display = 'block';
        joinRoomInput.focus();
        return;
      }
      const name = getRoomUsername();
      const code = joinRoomInput.value.trim();
      if (!name) { usernameInput.focus(); return; }
      if (!code) { joinRoomInput.focus(); return; }
      username = name;
      persistRoomUsername(name);
      closeRoomModal();
      document.getElementById('currentUser').textContent = 'User: ' + name;
      joinRoom(code);
    });
  }

  function openRoomModal(options = {}) {
    if (roomId && options.force) {
      selectTab('room');
      showToast('Zaten bir odadasin');
      return;
    }

    const modal = document.getElementById('welcomeModal');
    const usernameInput = document.getElementById('usernameInput');
    const usernameField = document.getElementById('usernameField');
    const joinRoomInput = document.getElementById('joinRoomInput');
    const joinRoomField = document.getElementById('joinRoomField');
    const createBtn = document.getElementById('createRoomBtn');
    const accountUser = window.CineVerseLibrary?.user || null;
    const description = modal.querySelector('p');
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const joinParam = params.get('join');
    const mode = options.mode || (roomParam || joinParam === 'true' ? 'join' : 'choose');
    const loggedIn = Boolean(accountUser);

    usernameField.hidden = loggedIn;
    if (description) {
      description.textContent = loggedIn
        ? 'Otaq yarada və ya mövcud otağa qoşula bilərsən.'
        : 'İzləməyə başlamaq üçün adını yaz və otaq yarat və ya mövcud otağa qoşul.';
    }
    if (loggedIn) {
      usernameInput.value = accountUser.username;
    } else {
      const savedName = localStorage.getItem('cv-username');
      if (savedName) usernameInput.value = savedName;
    }

    joinRoomField.style.display = mode === 'join' ? 'block' : 'none';
    createBtn.style.display = mode === 'join' ? 'none' : '';
    if (roomParam) {
      joinRoomField.style.display = 'block';
      joinRoomInput.value = roomParam;
      createBtn.style.display = 'none';
    }
    if (joinParam === 'true') {
      joinRoomField.style.display = 'block';
    }

    modal.classList.add('open');
    if (loggedIn && joinRoomField.style.display !== 'none') {
      joinRoomInput.focus();
    } else if (!loggedIn) {
      usernameInput.focus();
    }
  }

  function closeRoomModal() {
    document.getElementById('welcomeModal')?.classList.remove('open');
  }

  function getRoomUsername() {
    return window.CineVerseLibrary?.user?.username || document.getElementById('usernameInput').value.trim();
  }

  function persistRoomUsername(name) {
    if (!window.CineVerseLibrary?.user) {
      localStorage.setItem('cv-username', name);
    }
  }

  function selectTab(tabName) {
    const tab = document.querySelector(`.sidebar-tab[data-tab="${tabName}"]`);
    if (tab) tab.click();
  }

  // ===== PeerJS Room =====
  function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'cv-';
    for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function generateRoomHostToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function startAsHost() {
    intentionalRoomExit = false;
    bannedRoomUsers.clear();
    ChatModule.setMuted(false);
    isHost = true;
    stopSyncHeartbeat();
    stopRoomRegistryHeartbeat();
    roomId = generateRoomId();
    roomHostToken = generateRoomHostToken();
    roomDetails = { name: '', description: '' };
    setRoomDetailsInputs(roomDetails);
    roomSettings.visibility = 'private';
    applyRoomSettings(roomSettings);
    users = [{ name: username, peerId: roomId, roomRole: 'host', siteRole: getLocalSiteRole(), muted: false }];

    peer = new Peer(roomId, { config: ICE_SERVERS, debug: 1 });

    peer.on('open', (id) => {
      roomId = id;
      updateRoomUI();
      ChatModule.displayMessage('', `${username} odayı oluşturdu`, true);
      rememberRecentRoom(roomId, roomDetails.name || 'Kendi odam');
      updateUserList();
      startSyncHeartbeat();
      syncRoomRegistry({ immediate: true });
      window.dispatchEvent(new CustomEvent('cineverse:room-ready', { detail: { roomId, isHost: true } }));
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        connections.push(conn);
        conn.on('data', (data) => handleHostData(conn, data));
        conn.on('close', () => {
          if (intentionalRoomExit) return;
          connections = connections.filter(c => c !== conn);
          users = users.filter(u => u.peerId !== conn.peer);
          updateUserList();
          syncRoomRegistry({ immediate: true });
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
      const normalizedName = String(data.name || '').trim();
      if (bannedRoomUsers.has(normalizedName.toLowerCase()) || bannedRoomUsers.has(conn.peer)) {
        conn.send({ type: 'moderation-remove', reason: 'Bu otaqdan banlanmısan' });
        setTimeout(() => conn.close(), 80);
        return;
      }
      const siteRole = ['admin', 'moderator'].includes(data.siteRole) ? data.siteRole : 'user';
      const user = { name: normalizedName, peerId: conn.peer, roomRole: 'member', siteRole, muted: false };
      users.push(user);
      updateUserList();
      syncRoomRegistry({ immediate: true });
      conn.send({
        type: 'init',
        users,
        videoUrl: document.getElementById('videoUrlInput').value,
        contentId: currentRoomContent?.id || null,
        contentTitle: currentRoomContent?.title || currentRoomContent?.name || null,
        roomDetails,
        currentTime: PlayerController.getCurrentTime(),
        paused: PlayerController.isPaused(),
        speed: PlayerController.getSpeed(),
        settings: roomSettings,
        subtitleData: localSubtitleMode === 'shared' && lastSubtitleText
          ? { text: lastSubtitleText, filename: lastSubtitleFilename }
          : null
      });
      conn.send({ type: 'banned-list', list: bannedRoomList });
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
        currentRoomContent = makeRoomContent(data.url, data.contentId, data.contentTitle);
        window.CineVerseLibrary?.setActiveContent(currentRoomContent);
        PlayerController.loadSource(data.url);
        syncRoomRegistry({ immediate: true });
        broadcast({ type: 'video', url: data.url, contentId: data.contentId || null, contentTitle: data.contentTitle || null });
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
      if (isConnectionMuted(conn)) return sendMutedNotice(conn);
      ChatModule.displayMessage(data.name, data.text, false, true, null, data.reply, false, data.messageId);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'chat-image') {
      if (isConnectionMuted(conn)) return sendMutedNotice(conn);
      ChatModule.displayMessage(data.name, '', false, true, data.image, data.reply, false, data.messageId);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'typing') {
      if (isConnectionMuted(conn)) return;
      ChatModule.setTyping(data.name, data.isTyping);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'chat-reaction') {
      if (isConnectionMuted(conn)) return sendMutedNotice(conn);
      ChatModule.applyReaction(data.messageId, data.emoji);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'chat-edit') {
      if (isConnectionMuted(conn)) return sendMutedNotice(conn);
      ChatModule.applyEdit(data.messageId, data.text);
      connections.forEach(c => {
        if (c !== conn) c.send(data);
      });
    }

    if (data.type === 'moderation-action') {
      const actor = users.find(user => user.peerId === conn.peer);
      if (!canModerateRoom(actor)) return conn.send({ type: 'toast', msg: 'Moderasiya icazən yoxdur' });
      applyModerationAction(data.action, data.targetPeerId, actor);
    }

    if (data.type === 'unban-request') {
      const actor = users.find(user => user.peerId === conn.peer);
      if (!canModerateRoom(actor)) return conn.send({ type: 'toast', msg: 'Moderasiya icazən yoxdur' });
      unbanUser(data.peerId);
    }

    // Guest loaded subtitle (not used — only host sends subtitles)
  }

  let joinRetryCount = 0;
  const MAX_JOIN_RETRIES = 2;

  function joinRoom(hostId) {
    intentionalRoomExit = false;
    ChatModule.setMuted(false);
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
      rememberRecentRoom(hostId, 'Son oda');
      conn.send({ type: 'join', name: username, siteRole: getLocalSiteRole() });
      updateRoomUI();
    });

    conn.on('data', (data) => {
      if (data.type === 'init') {
        users = data.users;
        updateUserList();
        if (data.settings) applyRoomSettings(data.settings);
        if (data.roomDetails) {
          roomDetails = { ...roomDetails, ...data.roomDetails };
          setRoomDetailsInputs(roomDetails);
          rememberRecentRoom(roomId, roomDetails.name || 'Son oda');
        }
        if (data.speed) PlayerController.setSpeed(data.speed);
        if (data.subtitleData && shouldApplySharedSubtitles()) {
          applySharedSubtitle(data.subtitleData);
        }
        if (data.videoUrl) {
          document.getElementById('videoUrlInput').value = data.videoUrl;
          currentRoomContent = makeRoomContent(data.videoUrl, data.contentId, data.contentTitle);
          window.CineVerseLibrary?.setActiveContent(currentRoomContent);
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
      if (data.type === 'banned-list') {
        bannedRoomList = data.list;
        updateBannedListUI();
      }
      if (data.type === 'moderation-state') {
        const currentUser = users.find(user => user.peerId === peer?.id);
        if (currentUser) currentUser.muted = Boolean(data.muted);
        ChatModule.setMuted(Boolean(data.muted));
        updateUserList();
        showToast(data.muted ? 'Otaqda susturuldun' : 'Susturulman qaldırıldı');
      }
      if (data.type === 'moderation-remove') {
        intentionalRoomExit = true;
        leaveCurrentRoom({ remoteClosed: true, message: data.reason || 'Otaqdan çıxarıldın' });
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
        currentRoomContent = makeRoomContent(data.url, data.contentId, data.contentTitle);
        window.CineVerseLibrary?.setActiveContent(currentRoomContent);
        PlayerController.loadSource(data.url);
        window.CineVerseLibrary?.addLocalNotification({
          type: 'host_video_changed',
          title: 'Host videonu dəyişdi',
          body: data.contentTitle || data.url || 'Yeni video yükləndi'
        });
      }
      if (data.type === 'settings') {
        applyRoomSettings(data.settings);
      }
      if (data.type === 'room-details') {
        roomDetails = { ...roomDetails, ...data.details };
        setRoomDetailsInputs(roomDetails);
        rememberRecentRoom(roomId, roomDetails.name || 'Son oda');
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
      if (data.type === 'room-closed') {
        leaveCurrentRoom({ remoteClosed: true, message: data.message || 'Host otağı bağladı' });
      }
    });

    conn.on('close', () => {
      if (intentionalRoomExit || !roomId) return;
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


  function initActiveRooms() {
    document.getElementById('refreshRoomsBtn')?.addEventListener('click', () => loadActiveRooms({ showLoading: true }));
    renderRecentRooms();
    loadActiveRooms({ showLoading: true });
    activeRoomsTimer = setInterval(() => loadActiveRooms(), 15000);
    window.addEventListener('beforeunload', () => {
      if (isHost && roomSettings.visibility === 'public') unregisterRoom();
    });
  }

  async function loadActiveRooms(options = {}) {
    const list = document.getElementById('activeRoomsList');
    if (!list) return;
    if (options.showLoading) renderActiveRoomsMessage('Aktiv odalar yukleniyor...');

    try {
      const data = await roomApi('rooms');
      renderActiveRooms(data.rooms || []);
    } catch (err) {
      renderActiveRoomsMessage(err.message || 'Aktiv odalar yuklenemedi');
    }

    /*
      const actor = users.find(user => user.peerId === conn.peer);
      if (!canModerateRoom(actor)) return conn.send({ type: 'toast', msg: 'Moderasiya icazən yoxdur' });
      applyModerationAction(data.action, data.targetPeerId, actor);
    */
  }

  function renderActiveRooms(rooms) {
    const list = document.getElementById('activeRoomsList');
    if (!list) return;
    const visibleRooms = rooms;
    if (!visibleRooms.length) {
      renderActiveRoomsMessage('Aktiv public oda yok');
      return;
    }

    list.innerHTML = visibleRooms.map(room => `
      <button class="active-room-row" type="button" data-room-id="${escapeAttr(room.roomId)}">
        <strong>${escapeHTML(room.roomName || room.contentTitle || 'Birlikte izleme odasi')}</strong>
        <div class="active-room-meta">
          <span class="active-room-pill">${escapeHTML(room.hostName || 'Host')}</span>
          <span class="active-room-pill">${Number(room.memberCount || 1)} kisi</span>
          <span class="active-room-pill">${escapeHTML(room.roomId)}</span>
        </div>
        <div class="active-room-content">${escapeHTML(room.roomDescription || room.contentTitle || 'Icerik henuz secilmedi')}</div>
      </button>
    `).join('');

    list.querySelectorAll('[data-room-id]').forEach(button => {
      button.addEventListener('click', () => joinPublicRoom(button.dataset.roomId));
    });
  }

  function renderActiveRoomsMessage(message) {
    const list = document.getElementById('activeRoomsList');
    if (list) list.innerHTML = `<p class="empty-state">${escapeHTML(message)}</p>`;
  }

  function joinPublicRoom(publicRoomId) {
    if (!publicRoomId) return;
    if (roomId) {
      showToast(roomId === publicRoomId ? 'Zaten bu odadasin' : 'Once mevcut odadan cikmalisin');
      selectTab('room');
      return;
    }

    const name = getRoomUsername();
    if (!name) {
      openRoomModal({ mode: 'join', force: false });
      const input = document.getElementById('joinRoomInput');
      if (input) {
        input.value = publicRoomId;
        input.focus();
      }
      return;
    }

    username = name;
    persistRoomUsername(name);
    document.getElementById('currentUser').textContent = 'User: ' + name;
    joinRoom(publicRoomId);
  }

  function syncRoomRegistry(options = {}) {
    if (!isHost || !roomId || !roomHostToken) return;

    if (roomSettings.visibility !== 'public') {
      stopRoomRegistryHeartbeat();
      unregisterRoom();
      loadActiveRooms();
      return;
    }

    if (!roomRegistryTimer) {
      roomRegistryTimer = setInterval(registerRoom, 20000);
    }
    if (options.immediate) registerRoom();
  }

  async function registerRoom() {
    if (!isHost || !roomId || !roomHostToken || roomSettings.visibility !== 'public') return;

    try {
      await roomApi('rooms', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          hostName: username || 'Host',
          hostToken: roomHostToken,
          visibility: roomSettings.visibility,
          memberCount: Math.max(1, users.length || 1),
          contentTitle: getRoomContentTitle() || roomDetails.name,
          roomName: roomDetails.name,
          roomDescription: roomDetails.description
        })
      });
      loadActiveRooms();
    } catch (err) {
      console.warn('Room registry failed:', err);
    }
  }

  async function unregisterRoom() {
    if (!roomId || !roomHostToken) return;
    try {
      await roomApi(`rooms/${encodeURIComponent(roomId)}`, {
        method: 'DELETE',
        keepalive: true,
        body: JSON.stringify({ hostToken: roomHostToken })
      });
    } catch (err) {
      console.warn('Room unregister failed:', err);
    }
  }

  function stopRoomRegistryHeartbeat() {
    if (roomRegistryTimer) {
      clearInterval(roomRegistryTimer);
      roomRegistryTimer = null;
    }
  }

  function initRoomActions() {
    document.getElementById('leaveRoomBtn')?.addEventListener('click', () => {
      if (!roomId) return showToast('Aktiv otaq yoxdur');
      const message = isHost
        ? 'Host çıxdıqda otaq bağlanacaq. Otaqdan çıxmaq istəyirsən?'
        : 'Otaqdan çıxmaq istəyirsən?';
      if (window.confirm(message)) leaveCurrentRoom();
    });

    document.getElementById('deleteRoomBtn')?.addEventListener('click', () => {
      if (!roomId || !isHost) return;
      if (window.confirm('Otaq silinəcək və bütün üzvlər çıxarılacaq. Davam edilsin?')) {
        leaveCurrentRoom({ deleteRoom: true });
      }
    });
  }

  async function leaveCurrentRoom(options = {}) {
    if (!roomId) return;
    const leavingRoomId = roomId;
    const wasHost = isHost;
    intentionalRoomExit = true;

    if (wasHost && !options.remoteClosed) {
      broadcast({
        type: 'room-closed',
        message: options.deleteRoom ? 'Host otağı sildi' : 'Host otağı bağladı'
      });
      await new Promise(resolve => setTimeout(resolve, 120));
      await unregisterRoom();
    }

    stopSyncHeartbeat();
    stopRoomRegistryHeartbeat();
    connections.forEach(conn => {
      try { conn.close(); } catch {}
    });
    connections = [];
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch {}
    }
    peer = null;
    roomId = '';
    roomHostToken = '';
    isHost = false;
    users = [];
    bannedRoomUsers.clear();
    bannedRoomList = [];
    ChatModule.setMuted(false);
    joinRetryCount = 0;
    roomDetails = { name: '', description: '' };
    setRoomDetailsInputs(roomDetails);
    updateUserList();
    updateRoomUI();
    updateBannedListUI();

    if (options.deleteRoom) forgetRecentRoom(leavingRoomId);

    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('join');
    url.searchParams.delete('createRoom');
    history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));

    selectTab('room');
    showToast(options.message || (options.deleteRoom ? 'Otaq silindi' : 'Otaqdan çıxdın'));
  }

  function getRoomContentTitle() {
    const title = currentRoomContent?.title || currentRoomContent?.name || '';
    if (title) return title;
    const url = document.getElementById('videoUrlInput')?.value.trim();
    return url ? 'Manuel video' : '';
  }

  function makeRoomContent(url, contentId, contentTitle) {
    const title = String(contentTitle || '').trim();
    if (!contentId && !title) return null;
    return {
      ...(contentId ? { id: contentId } : {}),
      url,
      title
    };
  }

  function readRoomDetailsInputs() {
    return {
      name: document.getElementById('roomNameInput')?.value.trim().slice(0, 60) || '',
      description: document.getElementById('roomDescriptionInput')?.value.trim().slice(0, 160) || ''
    };
  }

  function setRoomDetailsInputs(details) {
    const nameInput = document.getElementById('roomNameInput');
    const descriptionInput = document.getElementById('roomDescriptionInput');
    if (nameInput) nameInput.value = details?.name || '';
    if (descriptionInput) descriptionInput.value = details?.description || '';
  }

  function rememberRecentRoom(nextRoomId, label) {
    if (!nextRoomId) return;
    const key = 'cv-recent-rooms';
    let rows = [];
    try {
      rows = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      rows = [];
    }
    const roomLink = window.location.origin + window.location.pathname + '?room=' + nextRoomId;
    rows = [
      { roomId: nextRoomId, label: label || nextRoomId, roomLink, updatedAt: new Date().toISOString() },
      ...rows.filter(item => item.roomId !== nextRoomId)
    ].slice(0, 6);
    localStorage.setItem(key, JSON.stringify(rows));
    renderRecentRooms();
  }

  function forgetRecentRoom(targetRoomId) {
    let rows = [];
    try {
      rows = JSON.parse(localStorage.getItem('cv-recent-rooms') || '[]');
    } catch {
      rows = [];
    }
    localStorage.setItem('cv-recent-rooms', JSON.stringify(rows.filter(item => item.roomId !== targetRoomId)));
    renderRecentRooms();
  }

  function renderRecentRooms() {
    const list = document.getElementById('recentRoomsList');
    if (!list) return;
    let rows = [];
    try {
      rows = JSON.parse(localStorage.getItem('cv-recent-rooms') || '[]');
    } catch {
      rows = [];
    }
    if (!rows.length) {
      list.innerHTML = '<p class="empty-state">Hələ otaq tarixçəsi yoxdur.</p>';
      return;
    }
    list.innerHTML = rows.map(item => `
      <button class="active-room-row" type="button" data-recent-room="${escapeAttr(item.roomId)}">
        <strong>${escapeHTML(item.label || item.roomId)}</strong>
        <div class="active-room-meta">
          <span class="active-room-pill">${escapeHTML(item.roomId)}</span>
          <span class="active-room-pill">${escapeHTML(formatRecentDate(item.updatedAt))}</span>
        </div>
      </button>
    `).join('');
    list.querySelectorAll('[data-recent-room]').forEach(button => {
      button.addEventListener('click', () => joinPublicRoom(button.dataset.recentRoom));
    });
  }

  function formatRecentDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'tarix yoxdur';
    return date.toLocaleString('az-AZ', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function roomApi(path, options = {}) {
    const response = await fetch(`/api/${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Islem basarisiz');
    return data;
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
    const roomLink = roomId ? window.location.origin + window.location.pathname + '?room=' + roomId : '';
    document.getElementById('roomLinkInput').value = roomLink;
    document.getElementById('roomActions').hidden = !roomId;
    document.getElementById('deleteRoomBtn').hidden = !roomId || !isHost;

    document.getElementById('copyLinkBtn').onclick = () => {
      if (!roomLink) return showToast('Aktiv otaq yoxdur');
      navigator.clipboard.writeText(roomLink).then(() => {
        showToast('Bağlantı kopyalandı! 📋');
      }).catch(() => {
        const input = document.getElementById('roomLinkInput');
        input.select();
        document.execCommand('copy');
        showToast('Bağlantı kopyalandı! 📋');
      });
    };
  }

  function updateUserList() {
    const list = document.getElementById('userList');
    list.innerHTML = '';
    const actor = getCurrentRoomUser();
    
    const isManager = canModerateRoom(actor);
    const bannedBtn = document.getElementById('bannedTabBtn');
    const mobileBannedBtn = document.getElementById('mobileBannedMenuBtn');
    if (bannedBtn) bannedBtn.hidden = !isManager;
    if (mobileBannedBtn) mobileBannedBtn.hidden = !isManager;

    users.forEach((u) => {
      const li = document.createElement('li');
      const initial = u.name.charAt(0).toUpperCase();
      const canAct = canModerateRoom(actor) && u.peerId !== actor?.peerId && u.roomRole !== 'host' && u.siteRole !== 'admin';
      const canPromote = actor?.roomRole === 'host' && !['admin', 'moderator'].includes(u.siteRole);
      li.innerHTML = `
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${escapeHTML(u.name)}</span>
        ${u.roomRole === 'host' ? '<span class="user-badge">Host</span>' : ''}
        ${u.roomRole === 'moderator' ? '<span class="user-badge moderator">İdarəçi</span>' : ''}
        ${u.siteRole === 'admin' ? '<span class="user-badge admin">Sayt admini</span>' : ''}
        ${u.siteRole === 'moderator' ? '<span class="user-badge admin">Sayt moderatoru</span>' : ''}
        ${u.muted ? '<span class="user-badge muted">Susturulub</span>' : ''}
        ${canAct ? `
          <div class="room-user-actions">
            <button type="button" data-room-action="mute" data-peer-id="${escapeAttr(u.peerId)}">${u.muted ? 'Səsi aç' : 'Sustur'}</button>
            <button type="button" data-room-action="kick" data-peer-id="${escapeAttr(u.peerId)}">Qov</button>
            <button type="button" data-room-action="ban" data-peer-id="${escapeAttr(u.peerId)}">Banla</button>
            ${canPromote ? `<button type="button" data-room-action="promote" data-peer-id="${escapeAttr(u.peerId)}">${u.roomRole === 'moderator' ? 'İdarəçiliyi al' : 'İdarəçi et'}</button>` : ''}
          </div>
        ` : ''}
      `;
      list.appendChild(li);
    });
    list.querySelectorAll('[data-room-action]').forEach(button => {
      button.addEventListener('click', () => requestModerationAction(button.dataset.roomAction, button.dataset.peerId));
    });
  }

  function getLocalSiteRole() {
    return window.CineVerseLibrary?.user?.role || 'user';
  }

  function getCurrentRoomUser() {
    if (isHost) return users.find(user => user.roomRole === 'host') || null;
    return users.find(user => user.peerId === peer?.id)
      || users.find(user => user.name === username && user.roomRole !== 'host')
      || null;
  }

  function canModerateRoom(user) {
    return Boolean(user && (
      user.roomRole === 'host'
      || user.roomRole === 'moderator'
      || user.siteRole === 'admin'
      || user.siteRole === 'moderator'
    ));
  }

  function requestModerationAction(action, targetPeerId) {
    const target = users.find(user => user.peerId === targetPeerId);
    if (!target) return;
    const labels = {
      mute: target.muted ? `${target.name} üçün susturmanı qaldırmaq` : `${target.name} adlı istifadəçini susturmaq`,
      kick: `${target.name} adlı istifadəçini otaqdan qovmaq`,
      ban: `${target.name} adlı istifadəçini banlamaq`,
      promote: target.roomRole === 'moderator' ? `${target.name} idarəçiliyini almaq` : `${target.name} adlı istifadəçini idarəçi etmək`
    };
    if (!window.confirm(`${labels[action]} istəyirsən?`)) return;
    if (isHost) {
      applyModerationAction(action, targetPeerId, getCurrentRoomUser());
    } else if (connections[0]?.open) {
      connections[0].send({ type: 'moderation-action', action, targetPeerId });
    }
  }

  function applyModerationAction(action, targetPeerId, actor) {
    const target = users.find(user => user.peerId === targetPeerId);
    if (!target || target.roomRole === 'host' || target.siteRole === 'admin' || !canModerateRoom(actor)) return;
    if (action === 'promote' && actor.roomRole !== 'host') return;

    if (action === 'promote') {
      target.roomRole = target.roomRole === 'moderator' ? 'member' : 'moderator';
      broadcast({ type: 'users', users });
      updateUserList();
      ChatModule.displayMessage('', `${target.name} ${target.roomRole === 'moderator' ? 'otaq idarəçisi edildi' : 'idarəçilikdən çıxarıldı'}`, true);
      return;
    }

    const targetConn = connections.find(conn => conn.peer === targetPeerId);
    if (action === 'mute') {
      target.muted = !target.muted;
      targetConn?.send({ type: 'moderation-state', muted: target.muted });
      broadcast({ type: 'users', users });
      updateUserList();
      return;
    }

    if (action === 'ban') {
      bannedRoomUsers.add(target.name.toLowerCase());
      bannedRoomUsers.add(target.peerId);
      if (!bannedRoomList.some(b => b.peerId === target.peerId)) {
        bannedRoomList.push({ name: target.name, peerId: target.peerId });
      }
      broadcast({ type: 'banned-list', list: bannedRoomList });
      updateBannedListUI();
    }

    if (action === 'kick' || action === 'ban') {
      targetConn?.send({
        type: 'moderation-remove',
        reason: action === 'ban' ? 'Bu otaqdan banlandın' : 'Otaqdan çıxarıldın'
      });
      setTimeout(() => targetConn?.close(), 100);
      users = users.filter(user => user.peerId !== targetPeerId);
      connections = connections.filter(conn => conn.peer !== targetPeerId);
      broadcast({ type: 'users', users });
      updateUserList();
      syncRoomRegistry({ immediate: true });
    }
  }

  function unbanUser(targetPeerId) {
    const item = bannedRoomList.find(b => b.peerId === targetPeerId);
    if (item) {
      bannedRoomUsers.delete(item.name.toLowerCase());
      bannedRoomUsers.delete(item.peerId);
      bannedRoomList = bannedRoomList.filter(b => b.peerId !== targetPeerId);
      broadcast({ type: 'banned-list', list: bannedRoomList });
      updateBannedListUI();
    }
  }

  function updateBannedListUI() {
    const list = document.getElementById('bannedUserList');
    if (!list) return;
    list.innerHTML = '';
    
    if (bannedRoomList.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = 'Banlanan istifadəçi yoxdur.';
      list.appendChild(p);
      return;
    }
    
    bannedRoomList.forEach(user => {
      const li = document.createElement('li');
      const initial = user.name.charAt(0).toUpperCase();
      li.innerHTML = `
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${escapeHTML(user.name)}</span>
        <div class="room-user-actions">
          <button type="button" data-unban-peer-id="${escapeAttr(user.peerId)}">Bərpa et</button>
        </div>
      `;
      list.appendChild(li);
    });
    
    list.querySelectorAll('[data-unban-peer-id]').forEach(button => {
      button.addEventListener('click', () => {
        const peerId = button.dataset.unbanPeerId;
        const targetUser = bannedRoomList.find(u => u.peerId === peerId);
        if (targetUser && window.confirm(`${targetUser.name} adlı istifadəçinin banını qaldırmaq istəyirsən?`)) {
          if (isHost) {
            unbanUser(peerId);
          } else if (connections[0]?.open) {
            connections[0].send({ type: 'unban-request', peerId });
          }
        }
      });
    });
  }

  function isConnectionMuted(conn) {
    return Boolean(users.find(user => user.peerId === conn.peer)?.muted);
  }

  function sendMutedNotice(conn) {
    conn.send({ type: 'moderation-state', muted: true });
  }

  // ===== Video Source =====
  function initVideoSource() {
    const loadBtn = document.getElementById('loadVideoBtn');
    const urlInput = document.getElementById('videoUrlInput');

    loadBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;
      window.CineVerseLibrary?.prepareManualLoad(url);
      const selectedContent = window.CineVerseLibrary?.getSelectedForUrl(url) || null;
      currentRoomContent = selectedContent;
      window.CineVerseLibrary?.setActiveContent(selectedContent);
      const contentTitle = selectedContent?.title || selectedContent?.name || '';

      if (isHost || !roomId) {
        // Host or solo playback: load locally. Hosts also broadcast to guests.
        PlayerController.loadSource(url);
        if (isHost) {
          syncRoomRegistry({ immediate: true });
          broadcast({ type: 'video', url, contentId: selectedContent?.id || null, contentTitle: contentTitle || null });
        }
        showToast('Video yukleniyor...');
      } else {
        // Guest: request from host
        if (connections[0] && connections[0].open) {
          connections[0].send({ type: 'guest-sync', action: 'video', url, contentId: selectedContent?.id || null, contentTitle: contentTitle || null });
          showToast('Video degistirme istegi gonderildi...');
        } else {
          showToast('Oda baglantisi hazir degil');
        }
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

  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
  }
})();
