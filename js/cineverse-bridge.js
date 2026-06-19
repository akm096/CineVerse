/**
 * CineVerse Android WebView bridge.
 *
 * Android exposes `window.CineVerseBridge` through addJavascriptInterface().
 * This adapter keeps native chat and playback state connected to the web UI.
 */
(() => {
  'use strict';

  const nativeBridge = window.CineVerseBridge;
  const isAndroidApp = Boolean(nativeBridge);
  const MAX_CHAT_LENGTH = 500;
  const VIDEO_DEDUPE_MS = 500;

  let context = Object.freeze({
    username: '',
    roomId: '',
    roomName: '',
    isHost: false
  });
  let initialized = false;
  let lastVideoPost = null;
  let pendingVideoSync = null;
  let pendingChatMessages = [];
  let remoteSyncUntil = 0;

  function callNative(methodName, ...args) {
    if (!isAndroidApp || typeof nativeBridge[methodName] !== 'function') return undefined;

    try {
      return nativeBridge[methodName](...args);
    } catch (error) {
      console.error(`[CineVerseBridge] ${methodName} failed`, error);
      return undefined;
    }
  }

  function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return String(value).toLowerCase() === 'true';
  }

  function normalizeTime(value) {
    const time = Number(value);
    return Number.isFinite(time) && time >= 0 ? time : null;
  }

  function refreshContext() {
    if (!isAndroidApp) return context;

    context = Object.freeze({
      username: String(callNative('getUsername') ?? ''),
      roomId: String(callNative('getRoomId') ?? ''),
      roomName: String(callNative('getRoomName') ?? ''),
      isHost: normalizeBoolean(callNative('isHost'))
    });

    applyContextToPage();
    window.dispatchEvent(new CustomEvent('cineverse:android-context', {
      detail: context
    }));

    return context;
  }

  function applyContextToPage() {
    if (context.username) {
      const usernameInput = document.getElementById('usernameInput');
      const currentUser = document.getElementById('currentUser');
      if (usernameInput) usernameInput.value = context.username;
      if (currentUser) currentUser.textContent = `User: ${context.username}`;
      try {
        localStorage.setItem('cv-username', context.username);
      } catch (error) {
        console.warn('[CineVerseBridge] Could not persist the Android username', error);
      }
    }

    if (context.roomId) {
      const joinRoomInput = document.getElementById('joinRoomInput');
      if (joinRoomInput) joinRoomInput.value = context.roomId;
    }

    if (context.roomName) {
      const roomNameInput = document.getElementById('roomNameInput');
      if (roomNameInput && !roomNameInput.value) roomNameInput.value = context.roomName;
    }
  }

  function postVideoSync(currentTime, isPlaying) {
    const time = normalizeTime(currentTime);
    if (time === null) return;

    const now = Date.now();
    const next = { time, isPlaying: Boolean(isPlaying), postedAt: now };
    if (
      lastVideoPost &&
      now - lastVideoPost.postedAt < VIDEO_DEDUPE_MS &&
      lastVideoPost.isPlaying === next.isPlaying &&
      Math.abs(lastVideoPost.time - next.time) < 0.15
    ) {
      return;
    }

    lastVideoPost = next;
    callNative('postVideoSync', time, next.isPlaying);
  }

  function handleWebPlayback(event) {
    if (!isAndroidApp) return;

    const detail = event.detail || {};
    if (!['play', 'pause', 'seek'].includes(detail.action)) return;

    const time = normalizeTime(detail.time);
    if (time === null) return;

    const isPlaying = typeof detail.isPlaying === 'boolean'
      ? detail.isPlaying
      : detail.action === 'play';

    postVideoSync(time, isPlaying);
  }

  function handleNativeVideoEvent(event) {
    if (!isAndroidApp || Date.now() < remoteSyncUntil) return;

    const video = event.currentTarget;
    postVideoSync(video.currentTime, !video.paused && !video.ended);
  }

  function handleWebChat(event) {
    if (!isAndroidApp) return;

    const message = String(event.detail?.text ?? '').trim().slice(0, MAX_CHAT_LENGTH);
    if (message) callNative('postChatMessage', message);
  }

  function displayIncomingChat(sender, message) {
    const safeSender = String(sender ?? '').trim().slice(0, 80) || 'CineVerse';
    const safeMessage = String(message ?? '').trim().slice(0, MAX_CHAT_LENGTH);
    if (!safeMessage) return;

    if (!initialized) {
      pendingChatMessages.push({ sender: safeSender, message: safeMessage });
      pendingChatMessages = pendingChatMessages.slice(-100);
      return;
    }

    if (typeof ChatModule !== 'undefined' && typeof ChatModule.displayMessage === 'function') {
      ChatModule.displayMessage(safeSender, safeMessage, false, true);
      return;
    }

    window.dispatchEvent(new CustomEvent('cineverse:android-chat', {
      detail: { sender: safeSender, message: safeMessage }
    }));
  }

  function applyIncomingVideo(currentTime, isPlaying) {
    const time = normalizeTime(currentTime);
    if (time === null) return;

    const shouldPlay = normalizeBoolean(isPlaying);
    if (!initialized || typeof PlayerController === 'undefined' || typeof PlayerController.applySync !== 'function') {
      pendingVideoSync = { time, isPlaying: shouldPlay };
      return;
    }

    pendingVideoSync = null;
    remoteSyncUntil = Date.now() + 1000;
    PlayerController.applySync(shouldPlay ? 'play' : 'pause', time);
  }

  window.onCineVerseChatMessageReceived = displayIncomingChat;
  window.syncCineVerseVideo = applyIncomingVideo;

  window.CineVerseWebBridge = Object.freeze({
    isAndroidApp,
    getContext: () => context,
    refreshContext,
    postVideoSync,
    postChatMessage(message) {
      const text = String(message ?? '').trim().slice(0, MAX_CHAT_LENGTH);
      if (text) callNative('postChatMessage', text);
    }
  });

  function init() {
    window.addEventListener('cineverse:player-sync', handleWebPlayback);
    window.addEventListener('cineverse:chat-send', handleWebChat);
    window.addEventListener('cineverse:room-ready', refreshContext);

    const video = document.getElementById('videoPlayer');
    video?.addEventListener('play', handleNativeVideoEvent);
    video?.addEventListener('pause', handleNativeVideoEvent);
    video?.addEventListener('seeked', handleNativeVideoEvent);

    initialized = true;
    refreshContext();

    if (pendingVideoSync) {
      applyIncomingVideo(pendingVideoSync.time, pendingVideoSync.isPlaying);
    }

    const queuedChats = pendingChatMessages;
    pendingChatMessages = [];
    queuedChats.forEach(item => displayIncomingChat(item.sender, item.message));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
