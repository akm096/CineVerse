/**
 * CineVerse — Chat Module
 * Emoji picker + message display + notification sound
 */
const ChatModule = (() => {
  const EMOJIS = [
    '😀','😂','🤣','😍','🥰','😎','🤩','😏','😅','😭',
    '🥺','😱','🤔','🤫','🤗','😴','🥱','😈','👻','💀',
    '🔥','❤️','💜','💙','💚','💛','🧡','💖','✨','⭐',
    '👍','👎','👏','🙌','💪','🤝','✌️','🤞','🫶','👀',
    '🎬','🍿','🎮','🎵','🎉','🎊','🏆','📺','🎭','🎪',
    '😇','🤠','🥳','😤','🙄','😒','😳','🫣','🤯','💩'
  ];

  let sendCallback = null;
  let notifSoundEnabled = true;
  let audioCtx = null;

  function init() {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendChatBtn');
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');

    // Populate emoji picker
    EMOJIS.forEach(e => {
      const span = document.createElement('span');
      span.textContent = e;
      span.addEventListener('click', () => {
        chatInput.value += e;
        chatInput.focus();
      });
      emojiPicker.appendChild(span);
    });

    // Toggle emoji picker
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      emojiPicker.classList.toggle('open');
    });

    // Close emoji picker on outside click
    document.addEventListener('click', (e) => {
      if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.classList.remove('open');
      }
    });

    // Send message
    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Notification sound toggle
    const notifToggle = document.getElementById('notifSoundToggle');
    if (notifToggle) {
      notifToggle.addEventListener('click', () => {
        notifToggle.classList.toggle('active');
        notifSoundEnabled = notifToggle.classList.contains('active');
      });
    }
  }

  function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    if (sendCallback) sendCallback(text);
  }

  /**
   * Play a short notification beep using Web Audio API
   */
  function playNotifSound() {
    if (!notifSoundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);   // A5
      osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.08); // up
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);

      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
      // Audio not supported or blocked
    }
  }

  /**
   * Display a chat message
   * @param {boolean} playSound - whether to play notification sound (for incoming messages)
   */
  function displayMessage(name, text, isSystem = false, playSound = false) {
    const container = document.getElementById('chatMessages');
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (isSystem) {
      const div = document.createElement('div');
      div.className = 'chat-msg system';
      div.innerHTML = `<span class="chat-msg-text">${escapeHTML(text)}</span>`;
      container.appendChild(div);
    } else {
      const initial = name.charAt(0).toUpperCase();
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `
        <div class="chat-msg-avatar">${initial}</div>
        <div class="chat-msg-body">
          <div class="chat-msg-name">${escapeHTML(name)}</div>
          <div class="chat-msg-text">${escapeHTML(text)}</div>
          <div class="chat-msg-time">${timeStr}</div>
        </div>
      `;
      container.appendChild(div);
    }

    // Auto-scroll
    container.scrollTop = container.scrollHeight;

    // Play notification sound for incoming messages
    if (playSound) playNotifSound();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function onSend(cb) { sendCallback = cb; }

  return { init, displayMessage, onSend };
})();
