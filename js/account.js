const CineVerseAccount = (() => {
  const state = {
    user: null,
    contents: [],
    series: [],
    watchlist: [],
    progress: [],
    profile: null,
    notifications: [],
    tags: [],
    mySubmissions: [],
    selectedContent: null,
    activeContent: null,
    progressTimer: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAuth();
    bindLibrary();
    bindAdmin();
    bindProfile();
    bindNotifications();
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
    if (!response.ok) throw new Error(data.error || 'Əməliyyat alınmadı');
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
      showToast('Çıxış edildi');
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
    if (!username || !password) return showToast('İstifadəçi adı və şifrə lazımdır');

    setLoginBusy(true);
    try {
      const data = await api('auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.user = data.user;
      closeModal('loginModal');
      setValue('loginPassword', '');
      showToast(`${data.user.username} kimi daxil oldun`);
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
    const canModerate = ['admin', 'moderator'].includes(role);
    text('authStatus', loggedIn ? `${state.user.username} (${role})` : 'Misafir');
    text('welcomeAuthStatus', loggedIn ? `${state.user.username} kimi daxil oldun` : 'Hesabsız davam edə bilərsən');
    setHidden('openLoginBtn', loggedIn);
    setHidden('welcomeLoginBtn', loggedIn);
    setHidden('openRoomBtn', !loggedIn);
    setHidden('logoutBtn', !loggedIn);
    setHidden('adminTabBtn', !canModerate);
    setHidden('libraryAdminLink', !['admin', 'uploader', 'moderator'].includes(role));
    setHidden('adminOnlyHint', canModerate);
    setHidden('librarySubmitLoginHint', loggedIn);
    setHidden('librarySubmitForm', !loggedIn);
    setHidden('watchlistLoginHint', loggedIn);
    setHidden('watchlistContent', !loggedIn);
    setHidden('continueLoginHint', loggedIn);
    setHidden('profileLoginHint', loggedIn);
    setHidden('profileContent', !loggedIn);
    setHidden('adminPanelContent', !canModerate);
    setHidden('adminDashboardSection', role !== 'admin');
    setHidden('adminCreateUserSection', role !== 'admin');
    setHidden('adminUsersSection', role !== 'admin');
    setHidden('notificationBtn', !loggedIn);
    window.dispatchEvent(new CustomEvent('cineverse:auth-change', { detail: { user: state.user } }));
  }

  function hydrateAccountData() {
    const load = () => {
      refreshWatchlist();
      refreshProgress();
      refreshLibrary();
      refreshProfile();
      refreshNotifications();
      refreshMySubmissions();
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
    button.textContent = isBusy ? 'Daxil olunur...' : 'Daxil ol';
  }

  function clearAccountData() {
    state.watchlist = [];
    state.progress = [];
    state.profile = null;
    renderEmpty('watchlistContent', '');
    renderEmpty('profileStats', '');
    renderEmpty('profileRecentList', '');
    refreshProgress();
  }

  function bindLibrary() {
    on('libraryRefreshBtn', 'click', refreshLibrary);
    on('librarySearchInput', 'keydown', event => {
      if (event.key === 'Enter') refreshLibrary();
    });
    on('libraryTypeFilter', 'change', refreshLibrary);
    on('libraryTagFilter', 'change', refreshLibrary);
    on('contentSubmitBtn', 'click', submitContent);
    on('tmdbSearchBtn', 'click', searchTmdb);
  }

  function bindNotifications() {
    on('notificationBtn', 'click', async () => {
      const panel = byId('notificationPanel');
      if (!panel) return;
      const libraryTab = document.querySelector('.sidebar-tab[data-tab="library"]');
      if (libraryTab && !document.getElementById('tab-library')?.classList.contains('active')) {
        libraryTab.click();
      }
      panel.hidden = false;
      await refreshNotifications();
      requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
    on('markNotificationsReadBtn', 'click', async () => {
      try {
        await api('notifications/read-all', { method: 'POST' });
        await refreshNotifications();
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  async function refreshNotifications() {
    if (!state.user) return;
    try {
      const data = await api('notifications');
      state.notifications = data.notifications || [];
      renderNotifications(data.unread || 0);
    } catch {
      state.notifications = [];
      renderNotifications(0);
    }
  }

  function renderNotifications(unread) {
    const badge = byId('notificationBadge');
    if (badge) {
      badge.textContent = unread;
      badge.hidden = unread < 1;
    }
    const list = byId('notificationList');
    if (!list) return;
    if (!state.notifications.length) return renderEmpty('notificationList', 'Bildiriş yoxdur');
    list.innerHTML = state.notifications.map(item => `
      <div class="compact-row ${item.readAt ? '' : 'unread-row'}">
        <div>
          <strong>${escapeHTML(item.title)}</strong>
          <span>${escapeHTML(item.body || '')}</span>
        </div>
        ${item.readAt ? '' : `<button class="btn btn-secondary btn-sm" data-read-notification="${escapeAttr(item.id)}">Oxu</button>`}
      </div>
    `).join('');
    list.querySelectorAll('[data-read-notification]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await api(`notifications/${button.dataset.readNotification}/read`, { method: 'POST' });
          await refreshNotifications();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  function addLocalNotification(notification) {
    const item = {
      id: `local-${Date.now()}`,
      type: notification.type || 'local',
      title: notification.title || 'Bildiriş',
      body: notification.body || '',
      readAt: null,
      createdAt: new Date().toISOString()
    };
    state.notifications = [item, ...state.notifications].slice(0, 40);
    renderNotifications(state.notifications.filter(row => !row.readAt).length);
  }

  function renderTagFilter() {
    const select = byId('libraryTagFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Tag</option>' + state.tags.map(item => `
      <option value="${escapeAttr(item.tag)}">${escapeHTML(item.tag)} (${Number(item.count || 0)})</option>
    `).join('');
    select.value = [...select.options].some(option => option.value === current) ? current : '';
  }

  async function refreshLibrary() {
    const query = new URLSearchParams();
    const type = value('libraryTypeFilter');
    const q = value('librarySearchInput');
    if (type) query.set('type', type);
    if (q) query.set('q', q);
    const tag = value('libraryTagFilter');
    if (tag) query.set('tag', tag);

    try {
      renderEmpty('libraryList', 'Yüklənir...');
      const seriesQuery = new URLSearchParams();
      seriesQuery.set('includeEpisodes', '1');
      if (q) seriesQuery.set('q', q);
      if (tag) seriesQuery.set('tag', tag);

      const [contentsData, seriesData, tagsData] = await Promise.all([
        type === 'series'
          ? api(`contents?type=series${q ? `&q=${encodeURIComponent(q)}` : ''}`)
          : api(`contents${query.toString() ? `?${query}` : ''}`),
        type === 'movie' ? Promise.resolve({ series: [] }) : api(`series?${seriesQuery}`),
        api('tags')
      ]);

      state.contents = contentsData.contents || [];
      state.series = seriesData.series || [];
      state.tags = tagsData.tags || [];
      renderTagFilter();
      renderContents();
    } catch (err) {
      renderEmpty('libraryList', err.message);
    }
  }

  function renderContents() {
    const list = byId('libraryList');
    if (!list) return;
    if (!state.contents.length && !state.series.length) return renderEmpty('libraryList', 'Kitabxana boşdur');

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
      : '<div class="content-poster placeholder">Serial</div>';
    const description = escapeHTML(series.description || '');
    const episodeRows = episodes.length
      ? episodes.map(episode => `
          <div class="series-episode-row">
            <div>
              <strong>${escapeHTML(episode.title || `S${episode.season || 0}E${episode.episode || 0}`)}</strong>
              <span>${escapeHTML(episodeMeta(episode))}</span>
            </div>
            <div class="content-actions">
              <button class="btn btn-primary btn-sm" data-play-content="${escapeAttr(episode.id)}">Otağa yüklə</button>
              <button class="btn btn-secondary btn-sm" data-copy-content="${escapeAttr(episode.id)}">Link</button>
              ${state.user ? `<select class="mini-select" data-list-content="${escapeAttr(episode.id)}">
                ${watchlistOptions(episode.id)}
              </select>` : ''}
            </div>
          </div>
        `).join('')
      : '<p class="empty-state">Bölüm yoxdur</p>';

    return `
      <details class="content-card series-card">
        <summary>
          ${poster}
          <div class="content-body">
            <div class="content-title">${escapeHTML(series.title)}</div>
            <div class="content-meta">Serial - ${Number(series.episodeCount || episodes.length || 0)} bölüm</div>
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
      content.type === 'series' ? 'Serial' : 'Film',
      content.season ? `S${content.season}` : '',
      content.episode ? `E${content.episode}` : '',
      content.releaseYear || '',
      content.genre || ''
    ].filter(Boolean).join(' - ');
    const poster = content.posterUrl
      ? `<img src="${escapeAttr(content.posterUrl)}" alt="" class="content-poster">`
      : `<div class="content-poster placeholder">${content.type === 'series' ? 'Serial' : 'Film'}</div>`;
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
          ${content.subtitleUrl ? '<div class="content-meta">Altyazı var</div>' : ''}
          ${content.tags?.length ? `<div class="content-meta">${escapeHTML(content.tags.join(' / '))}</div>` : ''}
          ${description ? `<p class="content-description">${description}</p>` : ''}
          <div class="content-url">${escapeHTML(content.url)}</div>
          <div class="content-actions">
            <button class="btn btn-primary btn-sm" data-play-content="${escapeAttr(content.id)}">Otağa yüklə</button>
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
    if (!payload.url) return showToast('Link lazımdır');

    try {
      const data = await api('contents', { method: 'POST', body: JSON.stringify(payload) });
      showToast(data.message || 'Göndərildi');
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
      if (!data.results?.length) return renderEmpty('tmdbResults', 'Nəticə tapılmadı');

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
          setValue('contentGenre', item.genre || '');
          setValue('contentTags', (item.tags || []).join(', '));
          setValue('contentReleaseYear', item.releaseYear || item.year || '');
          setValue('contentRuntime', item.runtimeMinutes || '');
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
      renderEmpty('watchlistContent', 'Yüklənir...');
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
      showToast('Siyahın yeniləndi');
      await refreshWatchlist();
      renderContents();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function refreshProgress() {
    if (!state.user) return renderLocalProgress();
    try {
      renderEmpty('continueContent', 'Yüklənir...');
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
    if (!state.progress.length) return renderEmpty('continueContent', 'Davam ediləcək kontent yoxdur');

    container.innerHTML = state.progress.map(item => `
      <div class="compact-row">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${formatTime(item.positionSeconds)} kaydedildi</span>
        </div>
        <button class="btn btn-primary btn-sm" data-progress-play="${escapeAttr(item.id)}">Davam</button>
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
    if (!rows.length) return renderEmpty('continueContent', 'Davam ediləcək kontent yoxdur');

    container.innerHTML = rows.map(item => `
      <div class="compact-row">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${formatTime(item.positionSeconds)} bu cihazda</span>
        </div>
        <button class="btn btn-primary btn-sm" data-local-progress="${escapeAttr(item.id)}">Davam</button>
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
    if (!['admin', 'moderator'].includes(state.user?.role)) return;
    try {
      const [users, submissions, stats] = await Promise.all([
        state.user?.role === 'admin' ? api('admin/users') : Promise.resolve({ users: [] }),
        api('admin/submissions'),
        state.user?.role === 'admin' ? api('admin/stats') : Promise.resolve({ stats: {}, recentContents: [] })
      ]);
      if (state.user?.role === 'admin') {
        renderAdminStats(stats);
        renderUsers(users.users || []);
      }
      renderSubmissions(submissions.submissions || []);
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderAdminStats(data) {
    const stats = data?.stats || {};
    const grid = byId('adminStatsGrid');
    if (grid) {
      grid.innerHTML = [
        statCard('Istifadeci', stats.users || 0),
        statCard('Kontent', stats.approvedContents || 0),
        statCard('Pending', stats.pendingSubmissions || 0),
        statCard('Public oda', stats.activePublicRooms || 0)
      ].join('');
    }

    const recent = byId('adminRecentContent');
    if (!recent) return;
    const rows = data?.recentContents || [];
    recent.innerHTML = rows.length
      ? rows.map(item => `
          <div class="compact-row">
            <div>
              <strong>${escapeHTML(item.title || item.url)}</strong>
              <span>${escapeHTML(item.type || 'video')}</span>
            </div>
          </div>
        `).join('')
      : '<p class="empty-state">Yeni kontent yoxdur</p>';
  }

  function bindProfile() {
    on('profileSaveBtn', 'click', saveProfile);
    document.querySelector('.sidebar-tab[data-tab="profile"]')?.addEventListener('click', refreshProfile);
  }

  async function refreshProfile() {
    if (!state.user) return;
    try {
      renderEmpty('profileStats', 'Yüklənir...');
      const data = await api('profile');
      state.profile = data;
      renderProfile(data);
      await refreshMySubmissions();
    } catch (err) {
      renderEmpty('profileStats', err.message);
    }
  }

  async function saveProfile() {
    if (!state.user) return showToast('Profil üçün daxil olmalısan');
    try {
      const data = await api('profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: value('profileDisplayName'),
          bio: value('profileBio')
        })
      });
      state.profile = data;
      renderProfile(data);
      showToast('Profil yeniləndi');
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderProfile(data) {
    const profile = data.profile || {};
    const stats = data.stats || {};
    setValue('profileDisplayName', profile.displayName || profile.username || '');
    setValue('profileBio', profile.bio || '');
    const grid = byId('profileStats');
    if (grid) {
      grid.innerHTML = [
        statCard('Listem', stats.watchlistCount || 0),
        statCard('Davam', stats.progressCount || 0),
        statCard('Izleme', formatTime(stats.watchedSeconds || 0))
      ].join('');
    }

    const recent = byId('profileRecentList');
    if (!recent) return;
    const rows = data.recent || [];
    recent.innerHTML = rows.length
      ? rows.map(item => `
          <div class="compact-row">
            <div>
              <strong>${escapeHTML(item.title || item.url)}</strong>
              <span>${formatTime(item.positionSeconds || 0)} kaydedildi</span>
            </div>
            <button class="btn btn-primary btn-sm" data-profile-play="${escapeAttr(item.id)}">Ac</button>
          </div>
        `).join('')
      : '<p class="empty-state">Son baxilan yoxdur</p>';
    recent.querySelectorAll('[data-profile-play]').forEach(button => {
      button.addEventListener('click', () => {
        const content = rows.find(item => item.id === button.dataset.profilePlay);
        if (content) playContent(content, Number(content.positionSeconds || 0));
      });
    });
  }

  async function refreshMySubmissions() {
    if (!state.user) return renderEmpty('mySubmissionsList', '');
    try {
      const data = await api('submissions/mine');
      state.mySubmissions = data.submissions || [];
      renderMySubmissions();
    } catch (err) {
      renderEmpty('mySubmissionsList', err.message);
    }
  }

  function renderMySubmissions() {
    const list = byId('mySubmissionsList');
    if (!list) return;
    if (!state.mySubmissions.length) return renderEmpty('mySubmissionsList', 'Təklif yoxdur');
    const labels = { pending: 'Gözləyir', approved: 'Təsdiqləndi', rejected: 'Rədd edildi' };
    list.innerHTML = state.mySubmissions.map(item => `
      <div class="compact-row">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${escapeHTML(labels[item.status] || item.status)}</span>
          ${item.moderationNote ? `<span>${escapeHTML(item.moderationNote)}</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  function statCard(label, valueText) {
    return `
      <div class="profile-stat-card">
        <strong>${escapeHTML(valueText)}</strong>
        <span>${escapeHTML(label)}</span>
      </div>
    `;
  }

  async function createAdminUser() {
    const payload = {
      username: value('adminNewUsername'),
      password: value('adminNewPassword'),
      role: value('adminNewRole') || 'user'
    };
    if (!payload.username || !payload.password) return showToast('İstifadəçi adı və şifrə lazımdır');

    try {
      await api('admin/users', { method: 'POST', body: JSON.stringify(payload) });
      setValue('adminNewUsername', '');
      setValue('adminNewPassword', '');
      showToast('İstifadəçi yaradıldı');
      await refreshAdmin();
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderUsers(users) {
    const list = byId('adminUsersList');
    if (!list) return;
    if (!users.length) return renderEmpty('adminUsersList', 'İstifadəçi yoxdur');

    list.innerHTML = users.map(user => `
      <div class="admin-row">
        <div>
          <strong>${escapeHTML(user.username)}</strong>
          <span>${escapeHTML(user.role)} ${user.active ? '' : '- pasif'}</span>
        </div>
        <select class="mini-select" data-user-role="${escapeAttr(user.id)}">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
          <option value="moderator" ${user.role === 'moderator' ? 'selected' : ''}>moderator</option>
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
    if (!submissions.length) return renderEmpty('adminSubmissionsList', 'Gözləyən link yoxdur');

    list.innerHTML = submissions.map(item => `
      <div class="admin-row stacked">
        <div>
          <strong>${escapeHTML(item.title || item.url)}</strong>
          <span>${escapeHTML(item.submittedByName || 'İstifadəçi')} tərəfindən</span>
          ${item.moderationNote ? `<span>Qeyd: ${escapeHTML(item.moderationNote)}</span>` : ''}
          <span>Yoxlama: ${escapeHTML(item.checkStatus || 'pending')}</span>
          <small>${escapeHTML(item.url)}</small>
        </div>
        <div class="content-actions">
          <button class="btn btn-secondary btn-sm" data-copy-submission="${escapeAttr(item.id)}">Link</button>
          <button class="btn btn-secondary btn-sm" data-check-submission="${escapeAttr(item.id)}">Yoxla</button>
          <button class="btn btn-secondary btn-sm" data-note-submission="${escapeAttr(item.id)}">Qeyd</button>
          <button class="btn btn-primary btn-sm" data-approve="${escapeAttr(item.id)}">Təsdiqlə</button>
          <button class="btn btn-secondary btn-sm" data-reject="${escapeAttr(item.id)}">Rədd et</button>
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
    list.querySelectorAll('[data-check-submission]').forEach(button => {
      button.addEventListener('click', () => checkSubmission(button.dataset.checkSubmission));
    });
    list.querySelectorAll('[data-note-submission]').forEach(button => {
      button.addEventListener('click', () => addModerationNote(button.dataset.noteSubmission));
    });
  }

  async function moderate(id, action) {
    try {
      const reason = action === 'reject' ? (prompt('Rədd səbəbi') || '') : '';
      await api(`admin/submissions/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      showToast(action === 'approve' ? 'Link təsdiqləndi' : 'Link rədd edildi');
      await Promise.all([refreshAdmin(), refreshLibrary()]);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function checkSubmission(id) {
    try {
      showToast('Linklər yoxlanılır...');
      const data = await api(`admin/contents/${id}/check`, { method: 'POST' });
      const failed = (data.checks || []).filter(item => item.status === 'failed').length;
      showToast(failed ? `${failed} yoxlama uğursuz oldu` : 'Link yoxlaması tamamlandı');
      await refreshAdmin();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function addModerationNote(id) {
    const note = prompt('Moderasiya qeydi');
    if (!note) return;
    try {
      await api(`contents/${id}/moderation-notes`, {
        method: 'POST',
        body: JSON.stringify({ note })
      });
      showToast('Qeyd saxlanıldı');
      await refreshAdmin();
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
    showToast('Otağa yüklənir');
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
      genre: value('contentGenre'),
      tags: value('contentTags'),
      type: value('contentType') || 'movie',
      season: value('contentSeason'),
      episode: value('contentEpisode'),
      releaseYear: value('contentReleaseYear'),
      runtimeMinutes: value('contentRuntime'),
      tmdbId: value('contentTmdbId')
    };
  }

  function clearContentForm() {
    ['contentUrl', 'contentTitle', 'contentDescription', 'contentPosterUrl', 'contentSubtitleUrl', 'contentGenre', 'contentTags', 'contentSeason', 'contentEpisode', 'contentReleaseYear', 'contentRuntime', 'contentTmdbId'].forEach(id => setValue(id, ''));
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
    addLocalNotification,
    refreshLibrary,
    refreshProgress
  };
})();

window.CineVerseLibrary = CineVerseAccount;
