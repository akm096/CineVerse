const CineVerseAccount = (() => {
  const state = {
    user: null,
    contents: [],
    series: [],
    watchlist: [],
    progress: [],
    selectedContent: null,
    activeContent: null,
    progressTimer: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAuth();
    bindLibrary();
    bindAdmin();
    refreshMe();
    refreshLibrary();
    loadAdminRoomContent();
    startProgressSaver();
  });

  async function api(path, options = {}) {
    const response = await fetch(`/api/${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Islem basarisiz');
    return data;
  }

  function bindAuth() {
    on('openLoginBtn', 'click', () => openModal('loginModal'));
    on('welcomeLoginBtn', 'click', () => openModal('loginModal'));
    on('closeLoginBtn', 'click', () => closeModal('loginModal'));
    on('logoutBtn', 'click', async () => {
      await api('auth/logout', { method: 'POST' });
      state.user = null;
      clearAccountData();
      showToast('Cikis yapildi');
      updateAuthUI();
      refreshLibrary();
    });
    on('loginSubmitBtn', 'click', login);
    on('loginPassword', 'keydown', event => {
      if (event.key === 'Enter') login();
    });
  }

  async function login() {
    const username = value('loginUsername');
    const password = value('loginPassword');
    if (!username || !password) return showToast('Kullanici adi ve sifre gerekli');

    setLoginBusy(true);
    try {
      const data = await api('auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.user = data.user;
      closeModal('loginModal');
      setValue('loginPassword', '');
      showToast(`${data.user.username} olarak giris yapildi`);
      updateAuthUI();
      hydrateAccountData();
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function refreshMe() {
    try {
      const data = await api('auth/me');
      state.user = data.user;
      updateAuthUI();
      if (state.user) {
        hydrateAccountData();
      } else {
        refreshProgress();
      }
    } catch {
      state.user = null;
      updateAuthUI();
    }
  }

  function updateAuthUI() {
    const loggedIn = Boolean(state.user);
    const role = state.user?.role || 'guest';
    text('authStatus', loggedIn ? `${state.user.username} (${role})` : 'Misafir');
    text('welcomeAuthStatus', loggedIn ? `${state.user.username} olarak giris yapildi` : 'Hesapsiz devam edebilirsin');
    setHidden('openLoginBtn', loggedIn);
    setHidden('welcomeLoginBtn', loggedIn);
    setHidden('openRoomBtn', !loggedIn);
    setHidden('logoutBtn', !loggedIn);
    setHidden('adminTabBtn', role !== 'admin');
    setHidden('libraryAdminLink', !['admin', 'uploader'].includes(role));
    setHidden('adminOnlyHint', role === 'admin');
    setHidden('librarySubmitLoginHint', loggedIn);
    setHidden('librarySubmitForm', !loggedIn);
    setHidden('watchlistLoginHint', loggedIn);
    setHidden('watchlistContent', !loggedIn);
    setHidden('continueLoginHint', loggedIn);
    setHidden('adminPanelContent', role !== 'admin');
    window.dispatchEvent(new CustomEvent('cineverse:auth-change', { detail: { user: state.user } }));
  }

  function hydrateAccountData() {
    const load = () => {
      refreshWatchlist();
      refreshProgress();
      refreshLibrary();
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(load, { timeout: 1200 });
    } else {
      setTimeout(load, 120);
    }
  }

  function setLoginBusy(isBusy) {
    const button = byId('loginSubmitBtn');
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = isBusy ? 'Giris yapiliyor...' : 'Giris yap';
  }

  function clearAccountData() {
    state.watchlist = [];
    state.progress = [];
    renderEmpty('watchlistContent', '');
    refreshProgress();
  }

  function bindLibrary() {
    on('libraryRefreshBtn', 'click', refreshLibrary);
    on('librarySearchInput', 'keydown', event => {
      if (event.key === 'Enter') refreshLibrary();
    });
    on('libraryTypeFilter', 'change', refreshLibrary);
    on('contentSubmitBtn', 'click', submitContent);
    on('tmdbSearchBtn', 'click', searchTmdb);
  }

  async function refreshLibrary() {
    const query = new URLSearchParams();
    const type = value('libraryTypeFilter');
    const q = value('librarySearchInput');
    if (type) query.set('type', type);
    if (q) query.set('q', q);

    try {
      const seriesQuery = new URLSearchParams();
      seriesQuery.set('includeEpisodes', '1');
      if (q) seriesQuery.set('q', q);

      const [contentsData, seriesData] = await Promise.all([
        type === 'series'
          ? api(`contents?type=series${q ? `&q=${encodeURIComponent(q)}` : ''}`)
          : api(`contents${query.toString() ? `?${query}` : ''}`),
        type === 'movie' ? Promise.resolve({ series: [] }) : api(`series?${seriesQuery}`)
      ]);

      state.contents = contentsData.contents || [];
      state.series = seriesData.series || [];
      renderContents();
    } catch (err) {
      renderEmpty('libraryList', err.message);
    }
  }

  function renderContents() {
    const list = byId('libraryList');
    if (!list) return;
    if (!state.contents.length && !state.series.length) return renderEmpty('libraryList', 'Kutuphane bos');

    list.innerHTML = [
      ...state.series.map(item => seriesCard(item)),
      ...state.contents.map(content => contentCard(content))
    ].join('');
    list.querySelectorAll('[data-play-content]').forEach(button => {
      button.addEventListener('click', () => {
        const content = findPlayableContent(button.dataset.playContent);
        if (content) playContent(content);
      });
    });
    list.querySelectorAll('[data-copy-content]').forEach(button => {
      button.addEventListener('click', () => {
        const content = findPlayableContent(button.dataset.copyContent);
        copyText(content?.url || '');
      });
    });
    list.querySelectorAll('[data-list-content]').forEach(select => {
      select.addEventListener('change', async () => {
        await saveWatchlist(select.dataset.listContent, select.value);
      });
    });
  }

  function seriesCard(series) {
    const episodes = Array.isArray(series.episodes) ? series.episodes : [];
    const poster = series.posterUrl
      ? `<img src="${escapeAttr(series.posterUrl)}" alt="" class="content-poster">`
      : '<div class="content-poster placeholder">Dizi</div>';
    const description = escapeHTML(series.description || '');
    const episodeRows = episodes.length
      ? episodes.map(episode => `
          <div class="series-episode-row">
            <div>
              <strong>${escapeHTML(episode.title || `S${episode.season || 0}E${episode.episode || 0}`)}</strong>
              <span>${escapeHTML(episodeMeta(episode))}</span>
            </div>
            <div class="content-actions">
              <button class="btn btn-primary btn-sm" data-play-content="${escapeAttr(episode.id)}">Odaya yukle</button>
              <button class="btn btn-secondary btn-sm" data-copy-content="${escapeAttr(episode.id)}">Link</button>
              ${state.user ? `<select class="mini-select" data-list-content="${escapeAttr(episode.id)}">
                ${watchlistOptions(episode.id)}
              </select>` : ''}
            </div>
          </div>
        `).join('')
      : '<p class="empty-state">Bolum yok</p>';

    return `
      <details class="content-card series-card">
        <summary>
          ${poster}
          <div class="content-body">
            <div class="content-title">${escapeHTML(series.title)}</div>
            <div class="content-meta">Dizi - ${Number(series.episodeCount || episodes.length || 0)} bolum</div>
            ${description ? `<p class="content-description">${description}</p>` : ''}
          </div>
        </summary>
        <div class="series-episodes">
          ${episodeRows}
        </div>
      </details>
    `;
  }

  function contentCard(content, options = {}) {
    const title = escapeHTML(content.title || content.url);
    const description = escapeHTML(content.description || '');
    const meta = [
      content.type === 'series' ? 'Dizi' : 'Film',
      content.season ? `S${content.season}` : '',
      content.episode ? `E${content.episode}` : ''
    ].filter(Boolean).join(' - ');
    const poster = content.posterUrl
      ? `<img src="${escapeAttr(content.posterUrl)}" alt="" class="content-poster">`
      : `<div class="content-poster placeholder">${content.type === 'series' ? 'Dizi' : 'Film'}</div>`;
    const watchlistControl = state.user && !options.noWatchlist
      ? `<select class="mini-select" data-list-content="${escapeAttr(content.id)}">
          ${watchlistOptions(content.id)}
        </select>`
      : '';

    return `
      <article class="content-card">
        ${poster}
        <div class="content-body">
          <div class="content-title">${title}</div>
          <div class="content-meta">${escapeHTML(meta || 'Video')}</div>
          ${content.subtitleUrl ? '<div class="content-meta">Altyazi var</div>' : ''}
          ${description ? `<p class="content-description">${description}</p>` : ''}
          <div class="content-url">${escapeHTML(content.url)}</div>
          <div class="content-actions">
            <button class="btn btn-primary btn-sm" data-play-content="${escapeAttr(content.id)}">Odaya yukle</button>
            <button class="btn btn-secondary btn-sm" data-copy-content="${escapeAttr(content.id)}">Link</button>
            ${watchlistControl}
          </div>
        </div>
      </article>
    `;
  }

  function episodeMeta(content) {
    return [
      content.season ? `S${content.season}` : '',
      content.episode ? `E${content.episode}` : '',
      content.url || ''
    ].filter(Boolean).join(' - ');
  }

  async function submitContent() {
    const payload = readContentForm();
    if (!payload.url) return showToast('Link gerekli');

    try {
      const data = await api('contents', { method: 'POST', body: JSON.stringify(payload) });
      showToast(data.message || 'Gonderildi');
      clearContentForm();
      await refreshLibrary();
      if (state.user?.role === 'admin') await refreshAdmin();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function searchTmdb() {
    const q = value('contentTitle') || value('tmdbSearchInput');
    const type = value('contentType') || 'movie';
    if (!q) return showToast('TMDB aramasi icin baslik yaz');

    try {
      const data = await api(`tmdb/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`);
      const list = byId('tmdbResults');
      if (!list) return;
      if (data.disabled) return renderEmpty('tmdbResults', 'TMDB anahtari ayarli degil');
      if (!data.results?.length) return renderEmpty('tmdbResults', 'Sonuc bulunamadi');

      list.innerHTML = data.results.map(item => `
        <button class="tmdb-result" data-tmdb-id="${escapeAttr(item.tmdbId)}">
          ${item.posterUrl ? `<img src="${escapeAttr(item.posterUrl)}" alt="">` : ''}
          <span>${escapeHTML(item.title)} ${item.year ? `(${escapeHTML(item.year)})` : ''}</span>
        </button>
      `).join('');
      list.querySelectorAll('.tmdb-result').forEach(button => {
        button.addEventListener('click', () => {
          const item = data.results.find(result => result.tmdbId === button.dataset.tmdbId);
          if (!item) return;
          setValue('contentTitle', item.title);
          setValue('contentDescription', item.description);
          setValue('contentPosterUrl', item.posterUrl);
          setValue('contentTmdbId', item.tmdbId);
          setValue('contentType', item.type);
          renderEmpty('tmdbResults', 'Bilgiler forma dolduruldu');
        });
      });
    } catch (err) {
      showToast(err.message);
    }
  }

  async function refreshWatchlist() {
    if (!state.user) {
      state.watchlist = [];
      return;
    }
    try {
      const data = await api('watchlist');
      state.watchlist = data.items || [];
      renderWatchlist();
      renderContents();
    } catch (err) {
      renderEmpty('watchlistContent', err.message);
    }
  }

  function renderWatchlist() {
    const container = byId('watchlistContent');
    if (!container) return;
    if (!state.watchlist.length) return renderEmpty('watchlistContent', 'Listen bos');

    const labels = { planned: 'Izleyecegim', watching: 'Izliyorum', watched: 'Izledim' };
    container.innerHTML = state.watchlist.map(item => `
      <div class="compact-row">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${labels[item.listStatus] || item.listStatus}</span>
        </div>
        <button class="btn btn-primary btn-sm" data-watch-play="${escapeAttr(item.id)}">Ac</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-watch-play]').forEach(button => {
      button.addEventListener('click', () => {
        const content = state.watchlist.find(item => item.id === button.dataset.watchPlay);
        if (content) playContent(content);
      });
    });
  }

  async function saveWatchlist(contentId, status) {
    if (!state.user || !contentId || !status) return;
    try {
      await api('watchlist', { method: 'POST', body: JSON.stringify({ contentId, status }) });
      showToast('Listem guncellendi');
      await refreshWatchlist();
      renderContents();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function refreshProgress() {
    if (!state.user) return renderLocalProgress();
    try {
      const data = await api('progress');
      state.progress = data.items || [];
      renderProgress();
    } catch (err) {
      renderEmpty('continueContent', err.message);
    }
  }

  function renderProgress() {
    const container = byId('continueContent');
    if (!container) return;
    if (!state.progress.length) return renderEmpty('continueContent', 'Devam edilecek icerik yok');

    container.innerHTML = state.progress.map(item => `
      <div class="compact-row">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${formatTime(item.positionSeconds)} kaydedildi</span>
        </div>
        <button class="btn btn-primary btn-sm" data-progress-play="${escapeAttr(item.id)}">Devam</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-progress-play]').forEach(button => {
      button.addEventListener('click', () => {
        const content = state.progress.find(item => item.id === button.dataset.progressPlay);
        if (content) playContent(content, Number(content.positionSeconds || 0));
      });
    });
  }

  function renderLocalProgress() {
    const container = byId('continueContent');
    if (!container || state.user) return;
    const rows = Object.keys(localStorage)
      .filter(key => key.startsWith('cv-progress-'))
      .map(key => {
        try {
          return JSON.parse(localStorage.getItem(key) || '{}');
        } catch {
          return {};
        }
      })
      .filter(item => item.id && item.url)
      .slice(-10)
      .reverse();
    if (!rows.length) return renderEmpty('continueContent', 'Devam edilecek icerik yok');

    container.innerHTML = rows.map(item => `
      <div class="compact-row">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${formatTime(item.positionSeconds)} bu cihazda</span>
        </div>
        <button class="btn btn-primary btn-sm" data-local-progress="${escapeAttr(item.id)}">Devam</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-local-progress]').forEach(button => {
      button.addEventListener('click', () => {
        const content = rows.find(item => item.id === button.dataset.localProgress);
        if (content) playContent(content, Number(content.positionSeconds || 0));
      });
    });
  }

  function startProgressSaver() {
    state.progressTimer = setInterval(saveProgressTick, 15000);
  }

  async function saveProgressTick() {
    if (!state.activeContent?.id || !window.PlayerController) return;
    const positionSeconds = PlayerController.getCurrentTime();
    if (!Number.isFinite(positionSeconds) || positionSeconds < 5) return;

    const durationSeconds = PlayerController.getDuration ? PlayerController.getDuration() : null;
    if (!state.user) {
      localStorage.setItem(`cv-progress-${state.activeContent.id}`, JSON.stringify({
        ...state.activeContent,
        positionSeconds,
        durationSeconds,
        updatedAt: new Date().toISOString()
      }));
      renderLocalProgress();
      return;
    }

    try {
      await api('progress', {
        method: 'POST',
        body: JSON.stringify({ contentId: state.activeContent.id, positionSeconds, durationSeconds })
      });
    } catch {
      // Progress should never interrupt watching.
    }
  }

  function bindAdmin() {
    on('adminCreateUserBtn', 'click', createAdminUser);
    on('adminRefreshBtn', 'click', refreshAdmin);
    on('adminTabBtn', 'click', refreshAdmin);
  }

  async function refreshAdmin() {
    if (state.user?.role !== 'admin') return;
    try {
      const [users, submissions] = await Promise.all([
        api('admin/users'),
        api('admin/submissions')
      ]);
      renderUsers(users.users || []);
      renderSubmissions(submissions.submissions || []);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function createAdminUser() {
    const payload = {
      username: value('adminNewUsername'),
      password: value('adminNewPassword'),
      role: value('adminNewRole') || 'user'
    };
    if (!payload.username || !payload.password) return showToast('Kullanici adi ve sifre gerekli');

    try {
      await api('admin/users', { method: 'POST', body: JSON.stringify(payload) });
      setValue('adminNewUsername', '');
      setValue('adminNewPassword', '');
      showToast('Kullanici olusturuldu');
      await refreshAdmin();
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderUsers(users) {
    const list = byId('adminUsersList');
    if (!list) return;
    if (!users.length) return renderEmpty('adminUsersList', 'Kullanici yok');

    list.innerHTML = users.map(user => `
      <div class="admin-row">
        <div>
          <strong>${escapeHTML(user.username)}</strong>
          <span>${escapeHTML(user.role)} ${user.active ? '' : '- pasif'}</span>
        </div>
        <select class="mini-select" data-user-role="${escapeAttr(user.id)}">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
          <option value="uploader" ${user.role === 'uploader' ? 'selected' : ''}>uploader</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
        </select>
      </div>
    `).join('');
    list.querySelectorAll('[data-user-role]').forEach(select => {
      select.addEventListener('change', async () => {
        try {
          await api(`admin/users/${select.dataset.userRole}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: select.value, active: true })
          });
          showToast('Rol guncellendi');
          await refreshAdmin();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  function renderSubmissions(submissions) {
    const list = byId('adminSubmissionsList');
    if (!list) return;
    if (!submissions.length) return renderEmpty('adminSubmissionsList', 'Bekleyen link yok');

    list.innerHTML = submissions.map(item => `
      <div class="admin-row stacked">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${escapeHTML(item.submittedByName || 'Kullanici')} tarafindan</span>
          <small>${escapeHTML(item.url)}</small>
        </div>
        <div class="content-actions">
          <button class="btn btn-secondary btn-sm" data-copy-submission="${escapeAttr(item.id)}">Link</button>
          <button class="btn btn-primary btn-sm" data-approve="${escapeAttr(item.id)}">Onayla</button>
          <button class="btn btn-secondary btn-sm" data-reject="${escapeAttr(item.id)}">Reddet</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-approve]').forEach(button => {
      button.addEventListener('click', () => moderate(button.dataset.approve, 'approve'));
    });
    list.querySelectorAll('[data-copy-submission]').forEach(button => {
      button.addEventListener('click', () => {
        const item = submissions.find(row => row.id === button.dataset.copySubmission);
        copyText(item?.url || '');
      });
    });
    list.querySelectorAll('[data-reject]').forEach(button => {
      button.addEventListener('click', () => moderate(button.dataset.reject, 'reject'));
    });
  }

  async function moderate(id, action) {
    try {
      await api(`admin/submissions/${id}/${action}`, { method: 'POST' });
      showToast(action === 'approve' ? 'Link onaylandi' : 'Link reddedildi');
      await Promise.all([refreshAdmin(), refreshLibrary()]);
    } catch (err) {
      showToast(err.message);
    }
  }

  function playContent(content, positionSeconds = 0) {
    state.selectedContent = content;
    state.activeContent = content;
    setValue('videoUrlInput', content.url);
    byId('loadVideoBtn')?.click();
    loadContentSubtitle(content);
    if (positionSeconds > 0) {
      setTimeout(() => PlayerController?.applySync('seek', positionSeconds), 1200);
    }
    showToast('Odaya yukleniyor');
  }

  function loadAdminRoomContent() {
    let content = null;
    try {
      content = JSON.parse(sessionStorage.getItem('cv-admin-room-content') || 'null');
      sessionStorage.removeItem('cv-admin-room-content');
    } catch {
      content = null;
    }

    if (!content?.url) return;
    state.selectedContent = content;
    state.activeContent = content;
    setValue('videoUrlInput', content.url);
    loadContentSubtitle(content);
    showToast('Secili medya hazir');
    let loaded = false;
    const loadSelected = () => {
      if (loaded) return;
      loaded = true;
      state.selectedContent = content;
      state.activeContent = content;
      byId('loadVideoBtn')?.click();
    };

    if (new URLSearchParams(window.location.search).get('createRoom') === '1') {
      window.addEventListener('cineverse:room-ready', loadSelected, { once: true });
      setTimeout(loadSelected, 2500);
      return;
    }

    setTimeout(loadSelected, 900);
  }

  function findPlayableContent(id) {
    return state.contents.find(item => item.id === id)
      || state.series.flatMap(item => item.episodes || []).find(item => item.id === id)
      || state.watchlist.find(item => item.id === id)
      || state.progress.find(item => item.id === id);
  }

  function loadContentSubtitle(content) {
    if (!content?.subtitleUrl) return;
    setTimeout(() => {
      setValue('subtitleUrlInput', content.subtitleUrl);
      byId('loadSubUrlBtn')?.click();
    }, 500);
  }

  function getSelectedForUrl(url) {
    if (state.selectedContent?.url === url) return state.selectedContent;
    return null;
  }

  function prepareManualLoad(url) {
    if (!state.selectedContent || state.selectedContent.url !== url) {
      state.selectedContent = null;
      state.activeContent = null;
    }
  }

  function setActiveContent(content) {
    state.activeContent = content || null;
    if (content?.id) {
      const last = getLocalProgress(content.id);
      if (!state.user && last?.positionSeconds > 5) {
        showToast(`Bu cihazda kaldigin yer: ${formatTime(last.positionSeconds)}`);
      }
    }
  }

  function getLocalProgress(id) {
    try {
      return JSON.parse(localStorage.getItem(`cv-progress-${id}`) || 'null');
    } catch {
      return null;
    }
  }

  function readContentForm() {
    return {
      url: urlValue('contentUrl'),
      title: value('contentTitle'),
      description: value('contentDescription'),
      posterUrl: value('contentPosterUrl'),
      subtitleUrl: urlValue('contentSubtitleUrl'),
      type: value('contentType') || 'movie',
      season: value('contentSeason'),
      episode: value('contentEpisode'),
      tmdbId: value('contentTmdbId')
    };
  }

  function clearContentForm() {
    ['contentUrl', 'contentTitle', 'contentDescription', 'contentPosterUrl', 'contentSubtitleUrl', 'contentSeason', 'contentEpisode', 'contentTmdbId'].forEach(id => setValue(id, ''));
    renderEmpty('tmdbResults', '');
  }

  function openModal(id) {
    byId(id)?.classList.add('open');
  }

  function closeModal(id) {
    byId(id)?.classList.remove('open');
  }

  function renderEmpty(id, message) {
    const el = byId(id);
    if (el) el.innerHTML = message ? `<p class="empty-state">${escapeHTML(message)}</p>` : '';
  }

  function copyText(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => showToast('Link kopyalandi')).catch(() => showToast(text));
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function watchlistOptions(contentId) {
    const current = state.watchlist.find(item => item.id === contentId)?.listStatus || '';
    const option = (value, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    return [
      option('', 'Listem'),
      option('planned', 'Izleyecegim'),
      option('watching', 'Izliyorum'),
      option('watched', 'Izledim')
    ].join('');
  }

  function on(id, event, handler) {
    byId(id)?.addEventListener(event, handler);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function value(id) {
    return byId(id)?.value.trim() || '';
  }

  function urlValue(id) {
    return value(id).replace(/&amp;/gi, '&').replace(/&#38;/g, '&');
  }

  function setValue(id, next) {
    const el = byId(id);
    if (el) el.value = next;
  }

  function text(id, next) {
    const el = byId(id);
    if (el) el.textContent = next;
  }

  function setHidden(id, hidden) {
    const el = byId(id);
    if (el) el.hidden = hidden;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
  }

  return {
    get user() { return state.user; },
    getSelectedForUrl,
    prepareManualLoad,
    setActiveContent,
    refreshLibrary,
    refreshProgress
  };
})();

window.CineVerseLibrary = CineVerseAccount;
