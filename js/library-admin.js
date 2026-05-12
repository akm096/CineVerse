const CineVerseLibraryAdmin = (() => {
  const state = {
    user: null,
    series: [],
    contents: [],
    pending: []
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindAuth();
    bindForms();
    refreshMe();
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

  function initTheme() {
    const toggle = byId('themeToggle');
    const saved = localStorage.getItem('cv-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    toggle?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('cv-theme', next);
    });
  }

  function bindAuth() {
    on('openLoginBtn', 'click', () => openModal('loginModal'));
    on('gateLoginBtn', 'click', () => openModal('loginModal'));
    on('closeLoginBtn', 'click', () => closeModal('loginModal'));
    on('loginSubmitBtn', 'click', login);
    on('loginPassword', 'keydown', event => {
      if (event.key === 'Enter') login();
    });
    on('logoutBtn', 'click', async () => {
      await api('auth/logout', { method: 'POST' });
      state.user = null;
      showToast('Cikis yapildi');
      updateAccess();
    });
  }

  function bindForms() {
    on('adminRefreshAllBtn', 'click', refreshAll);
    on('seriesSaveBtn', 'click', saveSeries);
    on('seriesCancelEditBtn', 'click', clearSeriesForm);
    on('episodeSaveBtn', 'click', saveEpisode);
    on('episodeCancelEditBtn', 'click', clearEpisodeForm);
    on('movieSaveBtn', 'click', saveMovie);
    on('movieCancelEditBtn', 'click', clearMovieForm);
    on('seriesTmdbBtn', 'click', () => searchTmdb('series'));
    on('movieTmdbBtn', 'click', () => searchTmdb('movie'));
    on('manageTypeFilter', 'change', refreshAll);
    on('manageSearch', 'keydown', event => {
      if (event.key === 'Enter') refreshAll();
    });
  }

  async function refreshMe() {
    try {
      const data = await api('auth/me');
      state.user = data.user;
    } catch {
      state.user = null;
    }
    updateAccess();
    if (canManage()) refreshAll();
  }

  function updateAccess() {
    const loggedIn = Boolean(state.user);
    const role = state.user?.role || 'guest';
    const allowed = canManage();

    text('authStatus', loggedIn ? `${state.user.username} (${role})` : 'Misafir');
    setHidden('openLoginBtn', loggedIn);
    setHidden('logoutBtn', !loggedIn);
    setHidden('adminWorkspace', !allowed);
    setHidden('accessGate', allowed);
    setHidden('pendingSection', role !== 'admin');

    if (!loggedIn) {
      text('accessMessage', 'Bu sayfa admin ve uploader hesaplari icindir.');
      setHidden('gateLoginBtn', false);
    } else if (!allowed) {
      text('accessMessage', 'Bu hesap kutuphane yonetimine yetkili degil.');
      setHidden('gateLoginBtn', true);
    }
  }

  async function login() {
    const username = value('loginUsername');
    const password = value('loginPassword');
    if (!username || !password) return showToast('Kullanici adi ve sifre gerekli');

    setBusy('loginSubmitBtn', true, 'Giris yapiliyor...');
    try {
      const data = await api('auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.user = data.user;
      closeModal('loginModal');
      setValue('loginPassword', '');
      showToast(`${data.user.username} olarak giris yapildi`);
      updateAccess();
      if (canManage()) refreshAll();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy('loginSubmitBtn', false, 'Giris yap');
    }
  }

  async function refreshAll() {
    if (!canManage()) return;

    const q = value('manageSearch');
    const type = value('manageTypeFilter');
    const seriesQuery = new URLSearchParams({ includeEpisodes: '1' });
    const contentsQuery = new URLSearchParams({ includeEpisodes: '1' });
    if (q) {
      seriesQuery.set('q', q);
      contentsQuery.set('q', q);
    }
    if (type) contentsQuery.set('type', type);

    try {
      const [seriesData, contentsData, pendingData] = await Promise.all([
        type === 'movie' ? Promise.resolve({ series: [] }) : api(`series?${seriesQuery}`),
        api(`contents?${contentsQuery}`),
        state.user?.role === 'admin' ? api('admin/submissions') : Promise.resolve({ submissions: [] })
      ]);
      state.series = seriesData.series || [];
      state.contents = contentsData.contents || [];
      state.pending = pendingData.submissions || [];
      renderSeriesSelect();
      renderManagement();
      renderPending();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function saveSeries() {
    const id = value('seriesId');
    const payload = {
      title: value('seriesTitle'),
      description: value('seriesDescription'),
      posterUrl: value('seriesPosterUrl'),
      tmdbId: value('seriesTmdbId')
    };
    if (!payload.title) return showToast('Dizi basligi gerekli');

    try {
      const path = id ? `series/${encodeURIComponent(id)}` : 'series';
      const method = id ? 'PATCH' : 'POST';
      await api(path, { method, body: JSON.stringify(payload) });
      showToast(id ? 'Dizi guncellendi' : 'Dizi olusturuldu');
      clearSeriesForm();
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function saveEpisode() {
    const seriesId = value('episodeSeriesSelect');
    const editId = value('episodeContentId');
    const original = state.contents.find(item => item.id === editId);
    const payload = {
      type: 'series',
      seriesId,
      season: value('episodeSeason'),
      episode: value('episodeNumber'),
      title: value('episodeTitle'),
      url: urlValue('episodeUrl'),
      subtitleUrl: urlValue('episodeSubtitleUrl'),
      description: original?.description || '',
      posterUrl: value('episodePosterUrl') || original?.posterUrl || '',
      tmdbId: original?.tmdbId || ''
    };
    if (!seriesId) return showToast('Dizi sec');
    if (!payload.season || !payload.episode || !payload.url) return showToast('Sezon, bolum ve link gerekli');

    try {
      if (editId) {
        await api(`contents/${encodeURIComponent(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        showToast('Bolum guncellendi');
      } else {
        await api(`series/${encodeURIComponent(seriesId)}/episodes`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showToast('Bolum eklendi');
      }
      clearEpisodeForm();
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function saveMovie() {
    const editId = value('movieContentId');
    const payload = {
      type: 'movie',
      title: value('movieTitle'),
      description: value('movieDescription'),
      posterUrl: value('moviePosterUrl'),
      url: urlValue('movieUrl'),
      subtitleUrl: urlValue('movieSubtitleUrl'),
      tmdbId: value('movieTmdbId')
    };
    if (!payload.url) return showToast('Film linki gerekli');

    try {
      if (editId) {
        await api(`contents/${encodeURIComponent(editId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        showToast('Film guncellendi');
      } else {
        const data = await api('contents', { method: 'POST', body: JSON.stringify(payload) });
        showToast(data.message || 'Film eklendi');
      }
      clearMovieForm();
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function searchTmdb(kind) {
    const isSeries = kind === 'series';
    const inputId = isSeries ? 'seriesTmdbSearch' : 'movieTmdbSearch';
    const titleId = isSeries ? 'seriesTitle' : 'movieTitle';
    const resultsId = isSeries ? 'seriesTmdbResults' : 'movieTmdbResults';
    const q = value(inputId) || value(titleId);
    if (!q) return showToast('TMDB aramasi icin baslik yaz');

    try {
      const data = await api(`tmdb/search?type=${isSeries ? 'series' : 'movie'}&q=${encodeURIComponent(q)}`);
      if (data.disabled) return renderEmpty(resultsId, 'TMDB anahtari ayarli degil');
      if (!data.results?.length) return renderEmpty(resultsId, 'Sonuc bulunamadi');

      const list = byId(resultsId);
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
          if (isSeries) {
            setValue('seriesTitle', item.title);
            setValue('seriesDescription', item.description);
            setValue('seriesPosterUrl', item.posterUrl);
            setValue('seriesTmdbId', item.tmdbId);
          } else {
            setValue('movieTitle', item.title);
            setValue('movieDescription', item.description);
            setValue('moviePosterUrl', item.posterUrl);
            setValue('movieTmdbId', item.tmdbId);
          }
          renderEmpty(resultsId, 'Bilgiler forma dolduruldu');
        });
      });
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderSeriesSelect() {
    const select = byId('episodeSeriesSelect');
    if (!select) return;
    select.innerHTML = state.series.length
      ? state.series.map(item => `<option value="${escapeAttr(item.id)}">${escapeHTML(item.title)}</option>`).join('')
      : '<option value="">Once dizi olustur</option>';
  }

  function renderManagement() {
    renderSeriesManagement();
    renderContentManagement();
  }

  function renderSeriesManagement() {
    const list = byId('seriesManagementList');
    if (!list) return;
    if (!state.series.length) return renderEmpty('seriesManagementList', 'Dizi yok');

    list.innerHTML = state.series.map(item => `
      <div class="admin-row stacked admin-media-row">
        <div class="admin-row-main">
          ${posterMarkup(item, 'Dizi')}
          <div>
            <strong>${escapeHTML(item.title)}</strong>
            <span>${Number(item.episodeCount || item.episodes?.length || 0)} bolum</span>
            ${item.description ? `<small>${escapeHTML(item.description)}</small>` : ''}
          </div>
        </div>
        <div class="content-actions">
          ${canManage() ? `<button class="btn btn-secondary btn-sm" data-edit-series="${escapeAttr(item.id)}">Duzenle</button>` : ''}
          ${state.user?.role === 'admin' ? `<button class="btn btn-secondary btn-sm danger-btn" data-delete-series="${escapeAttr(item.id)}">Sil</button>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-edit-series]').forEach(button => {
      button.addEventListener('click', () => startSeriesEdit(button.dataset.editSeries));
    });
    list.querySelectorAll('[data-delete-series]').forEach(button => {
      button.addEventListener('click', () => deleteSeries(button.dataset.deleteSeries));
    });
  }

  function renderContentManagement() {
    const list = byId('contentManagementList');
    if (!list) return;
    if (!state.contents.length) return renderEmpty('contentManagementList', 'Icerik yok');

    list.innerHTML = state.contents.map(item => `
      <div class="admin-row stacked admin-media-row">
        <div class="admin-row-main">
          ${posterMarkup(item, item.type === 'series' ? 'Bolum' : 'Film')}
          <div>
            <strong>${escapeHTML(item.title || item.url)}</strong>
            <span>${escapeHTML(contentMeta(item))}</span>
            ${item.subtitleUrl ? '<span>Altyazi var</span>' : ''}
            <small>${escapeHTML(item.url)}</small>
          </div>
        </div>
        <div class="content-actions">
          <button class="btn btn-primary btn-sm" data-room-content="${escapeAttr(item.id)}">Oda kur</button>
          <button class="btn btn-secondary btn-sm" data-copy-content="${escapeAttr(item.id)}">Link kopyala</button>
          ${canManage() ? `<button class="btn btn-secondary btn-sm" data-edit-content="${escapeAttr(item.id)}">Duzenle</button>` : ''}
          ${state.user?.role === 'admin' ? `<button class="btn btn-secondary btn-sm danger-btn" data-delete-content="${escapeAttr(item.id)}">Sil</button>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-room-content]').forEach(button => {
      button.addEventListener('click', () => startRoomWithContent(button.dataset.roomContent));
    });
    list.querySelectorAll('[data-copy-content]').forEach(button => {
      button.addEventListener('click', () => {
        const item = state.contents.find(content => content.id === button.dataset.copyContent);
        copyText(item?.url || '');
      });
    });
    list.querySelectorAll('[data-edit-content]').forEach(button => {
      button.addEventListener('click', () => startContentEdit(button.dataset.editContent));
    });
    list.querySelectorAll('[data-delete-content]').forEach(button => {
      button.addEventListener('click', () => deleteContent(button.dataset.deleteContent));
    });
  }

  function renderPending() {
    const list = byId('pendingList');
    if (!list || state.user?.role !== 'admin') return;
    if (!state.pending.length) return renderEmpty('pendingList', 'Bekleyen oneriler yok');

    list.innerHTML = state.pending.map(item => `
      <div class="admin-row stacked admin-media-row">
        <div class="admin-row-main">
          ${posterMarkup(item, item.type === 'series' ? 'Dizi' : 'Film')}
          <div>
            <strong>${escapeHTML(item.title || item.url)}</strong>
            <span>${escapeHTML(item.submittedByName || 'Kullanici')} tarafindan</span>
            <small>${escapeHTML(item.url)}</small>
          </div>
        </div>
        <div class="content-actions">
          <button class="btn btn-primary btn-sm" data-approve="${escapeAttr(item.id)}">Onayla</button>
          <button class="btn btn-secondary btn-sm" data-reject="${escapeAttr(item.id)}">Reddet</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-approve]').forEach(button => {
      button.addEventListener('click', () => moderate(button.dataset.approve, 'approve'));
    });
    list.querySelectorAll('[data-reject]').forEach(button => {
      button.addEventListener('click', () => moderate(button.dataset.reject, 'reject'));
    });
  }

  function startSeriesEdit(id) {
    const item = state.series.find(row => row.id === id);
    if (!item) return;
    setValue('seriesId', item.id);
    setValue('seriesTitle', item.title || '');
    setValue('seriesDescription', item.description || '');
    setValue('seriesPosterUrl', item.posterUrl || '');
    setValue('seriesTmdbId', item.tmdbId || '');
    text('seriesSaveBtn', 'Dizi guncelle');
    setHidden('seriesCancelEditBtn', false);
    byId('seriesTitle')?.focus();
  }

  function startContentEdit(id) {
    if (!canManage()) return showToast('Duzenleme icin admin veya uploader yetkisi gerekli');
    const item = state.contents.find(row => row.id === id);
    if (!item) return;

    if (item.type === 'series') {
      setValue('episodeContentId', item.id);
      setValue('episodeSeriesSelect', item.seriesId || '');
      setValue('episodeSeason', item.season ?? '');
      setValue('episodeNumber', item.episode ?? '');
      setValue('episodeTitle', item.title || '');
      setValue('episodePosterUrl', item.posterUrl || '');
      setValue('episodeUrl', item.url || '');
      setValue('episodeSubtitleUrl', item.subtitleUrl || '');
      text('episodeSaveBtn', 'Bolum guncelle');
      setHidden('episodeCancelEditBtn', false);
      byId('episodeUrl')?.focus();
      return;
    }

    setValue('movieContentId', item.id);
    setValue('movieTitle', item.title || '');
    setValue('movieDescription', item.description || '');
    setValue('moviePosterUrl', item.posterUrl || '');
    setValue('movieUrl', item.url || '');
    setValue('movieSubtitleUrl', item.subtitleUrl || '');
    setValue('movieTmdbId', item.tmdbId || '');
    text('movieSaveBtn', 'Film guncelle');
    setHidden('movieCancelEditBtn', false);
    byId('movieUrl')?.focus();
  }

  function clearSeriesForm() {
    ['seriesId', 'seriesTitle', 'seriesDescription', 'seriesPosterUrl', 'seriesTmdbId', 'seriesTmdbSearch'].forEach(id => setValue(id, ''));
    renderEmpty('seriesTmdbResults', '');
    text('seriesSaveBtn', 'Dizi olustur');
    setHidden('seriesCancelEditBtn', true);
  }

  function clearEpisodeForm() {
    ['episodeContentId', 'episodeSeason', 'episodeNumber', 'episodeTitle', 'episodePosterUrl', 'episodeUrl', 'episodeSubtitleUrl'].forEach(id => setValue(id, ''));
    text('episodeSaveBtn', 'Bolum ekle');
    setHidden('episodeCancelEditBtn', true);
  }

  function clearMovieForm() {
    ['movieContentId', 'movieTitle', 'movieDescription', 'moviePosterUrl', 'movieUrl', 'movieSubtitleUrl', 'movieTmdbId', 'movieTmdbSearch'].forEach(id => setValue(id, ''));
    renderEmpty('movieTmdbResults', '');
    text('movieSaveBtn', 'Film ekle');
    setHidden('movieCancelEditBtn', true);
  }

  function startRoomWithContent(id) {
    const item = state.contents.find(row => row.id === id);
    if (!item?.url) return showToast('Medya linki bulunamadi');

    sessionStorage.setItem('cv-admin-room-content', JSON.stringify(item));
    window.location.href = 'player.html?createRoom=1';
  }

  async function deleteSeries(id) {
    if (!confirm('Dizi ve bagli bolumler kalici olarak silinsin mi?')) return;
    try {
      await api(`series/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast('Dizi silindi');
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteContent(id) {
    if (!confirm('Icerik kalici olarak silinsin mi?')) return;
    try {
      await api(`contents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast('Icerik silindi');
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function moderate(id, action) {
    try {
      await api(`admin/submissions/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      showToast(action === 'approve' ? 'Oneri onaylandi' : 'Oneri reddedildi');
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  }

  function contentMeta(item) {
    const type = item.type === 'series' ? 'Bolum' : 'Film';
    return [
      type,
      item.season ? `S${item.season}` : '',
      item.episode ? `E${item.episode}` : ''
    ].filter(Boolean).join(' - ');
  }

  function posterMarkup(item, fallback) {
    return item.posterUrl
      ? `<img src="${escapeAttr(item.posterUrl)}" alt="" class="admin-thumb">`
      : `<div class="admin-thumb placeholder">${escapeHTML(fallback)}</div>`;
  }

  function copyText(text) {
    if (!text) return showToast('Kopyalanacak link yok');
    navigator.clipboard?.writeText(text)
      .then(() => showToast('Link kopyalandi'))
      .catch(() => {
        showToast(text);
      });
  }

  function canManage() {
    return ['admin', 'uploader'].includes(state.user?.role);
  }

  function setBusy(id, busy, label) {
    const button = byId(id);
    if (!button) return;
    button.disabled = busy;
    button.textContent = label;
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

  window.showToast = function(msg) {
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  };

  return { refreshAll };
})();

window.CineVerseLibraryAdmin = CineVerseLibraryAdmin;
