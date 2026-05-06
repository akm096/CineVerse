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
  let imageSendCallback = null;
  let notifSoundEnabled = true;
  let audioCtx = null;
  let selectedReply = null;
  let lastMessageGroup = null;
  let messageSeq = 0;

  function init() {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendChatBtn');
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    const imageBtn = document.getElementById('chatImageBtn');
    const imageInput = document.getElementById('chatImageInput');
    const cancelReplyBtn = document.getElementById('cancelReplyBtn');
    const chatMessages = document.getElementById('chatMessages');

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

    imageBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', () => {
      const file = imageInput.files && imageInput.files[0];
      imageInput.value = '';
      if (file) sendImage(file);
    });

    chatInput.addEventListener('paste', handlePaste);
    document.addEventListener('paste', (e) => {
      if (document.activeElement === chatInput) return;
      if (!shouldHandleGlobalPaste()) return;
      handlePaste(e);
    });

    cancelReplyBtn.addEventListener('click', clearReply);
    chatMessages.addEventListener('click', (e) => {
      const replyBtn = e.target.closest('.chat-reply-action');
      if (!replyBtn) return;
      const item = replyBtn.closest('.chat-message-item');
      if (!item) return;
      setReply({
        name: item.dataset.name,
        text: item.dataset.preview,
        type: item.dataset.type
      });
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
    const reply = selectedReply;
    clearReply();
    if (sendCallback) sendCallback(text, reply);
  }

  function sendImage(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Sadece görsel dosyası seçilebilir');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('Görsel çok büyük. En fazla 8 MB seçin.');
      return;
    }

    resizeImage(file)
      .then(image => {
        if (image.dataUrl.length > 1200000) {
          showToast('Görsel çok büyük kaldı. Daha küçük bir görsel deneyin.');
          return;
        }
        const reply = selectedReply;
        clearReply();
        if (imageSendCallback) imageSendCallback(image, reply);
      })
      .catch(() => showToast('Görsel hazırlanamadı'));
  }

  function handlePaste(e) {
    const items = e.clipboardData && Array.from(e.clipboardData.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    sendImage(file);
  }

  function shouldHandleGlobalPaste() {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return false;
    }
    return document.getElementById('tab-chat')?.classList.contains('active');
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const maxSide = 1280;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          let quality = 0.78;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > 900000 && quality > 0.45) {
            quality -= 0.08;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          resolve({
            dataUrl,
            name: file.name,
            width: canvas.width,
            height: canvas.height
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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
  function displayMessage(name, text, isSystem = false, playSound = false, image = null, reply = null, isOwn = false) {
    const container = document.getElementById('chatMessages');
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (isSystem) {
      lastMessageGroup = null;
      const div = document.createElement('div');
      div.className = 'chat-msg system';
      div.innerHTML = `<span class="chat-msg-text">${escapeHTML(text)}</span>`;
      container.appendChild(div);
    } else {
      const message = createMessageItem(name, text, image, reply, timeStr);
      if (lastMessageGroup && lastMessageGroup.dataset.name === name && lastMessageGroup.dataset.own === String(isOwn)) {
        lastMessageGroup.querySelector('.chat-msg-body').appendChild(message);
      } else {
        const initial = name.charAt(0).toUpperCase();
        const div = document.createElement('div');
        div.className = isOwn ? 'chat-msg own' : 'chat-msg';
        div.dataset.name = name;
        div.dataset.own = String(isOwn);
        div.innerHTML = `
          ${isOwn ? '' : `<div class="chat-msg-avatar">${escapeHTML(initial)}</div>`}
          <div class="chat-msg-body">
            ${isOwn ? '' : `<div class="chat-msg-name">${escapeHTML(name)}</div>`}
          </div>
        `;
        div.querySelector('.chat-msg-body').appendChild(message);
        container.appendChild(div);
        lastMessageGroup = div;
      }
    }

    // Auto-scroll
    container.scrollTop = container.scrollHeight;

    // Play notification sound for incoming messages
    if (playSound) playNotifSound();
  }

  function createMessageItem(name, text, image, reply, timeStr) {
    const item = document.createElement('div');
    const id = `msg-${Date.now()}-${++messageSeq}`;
    const preview = image ? 'Görsel' : text;

    item.className = 'chat-message-item';
    item.id = id;
    item.dataset.name = name;
    item.dataset.preview = preview.slice(0, 180);
    item.dataset.type = image ? 'image' : 'text';
    item.innerHTML = `
      ${renderReplyQuote(reply)}
      ${image ? renderImage(image) : `<div class="chat-msg-text">${escapeHTML(text)}</div>`}
      <div class="chat-msg-meta">
        <span class="chat-msg-time">${timeStr}</span>
        <button class="chat-reply-action" type="button">Yanıtla</button>
      </div>
    `;
    return item;
  }

  function renderReplyQuote(reply) {
    if (!reply || !reply.name) return '';
    const label = reply.type === 'image' ? 'Görsel' : reply.text;
    return `
      <div class="chat-reply-quote">
        <div class="chat-reply-name">${escapeHTML(reply.name)}</div>
        <div class="chat-reply-text">${escapeHTML(label || '')}</div>
      </div>
    `;
  }

  function renderImage(image) {
    const safeImage = normalizeImage(image);
    if (!safeImage) return '<div class="chat-msg-text">Görsel gösterilemedi</div>';

    return `
      <a class="chat-image-link" href="${escapeAttr(safeImage.dataUrl)}" target="_blank" rel="noopener">
        <img class="chat-image" src="${escapeAttr(safeImage.dataUrl)}" alt="${escapeAttr(safeImage.name || 'Sohbet görseli')}" loading="lazy">
      </a>
    `;
  }

  function normalizeImage(image) {
    if (!image || typeof image.dataUrl !== 'string') return null;
    if (image.dataUrl.length > 1200000) return null;
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(image.dataUrl)) return null;
    return {
      dataUrl: image.dataUrl,
      name: String(image.name || 'Sohbet görseli')
    };
  }

  function setReply(reply) {
    selectedReply = {
      name: String(reply.name || ''),
      text: String(reply.text || '').slice(0, 180),
      type: reply.type === 'image' ? 'image' : 'text'
    };
    document.getElementById('replyPreviewName').textContent = selectedReply.name;
    document.getElementById('replyPreviewText').textContent = selectedReply.type === 'image' ? 'Görsel' : selectedReply.text;
    document.getElementById('replyPreview').style.display = 'flex';
    document.getElementById('chatInput').focus();
  }

  function clearReply() {
    selectedReply = null;
    const preview = document.getElementById('replyPreview');
    if (preview) preview.style.display = 'none';
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function onSend(cb) { sendCallback = cb; }
  function onImageSend(cb) { imageSendCallback = cb; }

  return { init, displayMessage, onSend, onImageSend };
})();
