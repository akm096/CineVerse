<div align="center">

<img src="https://img.shields.io/badge/CineVerse-v1.0-7c3aed?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjxwb2x5Z29uIHBvaW50cz0iMTMsMTAgMjMsMTYgMTMsMjIiIGZpbGw9IndoaXRlIi8+PC9zdmc+" alt="CineVerse">

# 🎬 CineVerse

**Arkadaşlarınla senkron video izle — altyazı, sohbet ve oda desteğiyle.**

[![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HLS.js](https://img.shields.io/badge/HLS.js-ff6b6b?style=flat-square)](https://github.com/video-dev/hls.js)
[![PeerJS](https://img.shields.io/badge/PeerJS-7c3aed?style=flat-square)](https://peerjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[🚀 Canlıya Git](https://cineverse.pages.dev) · [🐛 Hata Bildir](https://github.com/akm096/CineVerse/issues) · [💡 Öneri Sun](https://github.com/akm096/CineVerse/issues)

</div>

---

## ✨ Özellikler

| Özellik | Detay |
|---|---|
| 🎬 **MP4 + M3U8/HLS** | Doğrudan URL yapıştırarak her iki formatı oynat |
| ⚡ **Oynatma Hızı** | 0.25x'ten 3x'e kadar 10 farklı hız seçeneği |
| 📝 **Altyazı** | SRT, VTT, JSON — URL veya dosya yükle, sürükle-bırak desteği |
| 🎨 **Altyazı Özelleştirme** | Boyut, renk, arka plan, opaklık, konum ayarları |
| 👥 **Oda Sistemi** | P2P bağlantı ile senkron izleme, paylaşılabilir oda linki |
| 💬 **Canlı Sohbet** | Emoji destekli gerçek zamanlı sohbet |
| 🔔 **Bildirim Sesi** | Mesaj gelince ayarlanabilir bildirim sesi |
| 🌗 **Koyu/Açık Tema** | Tek tıkla tema değiştirme, tercih kaydedilir |
| ⚙️ **Oda Ayarları** | "Sadece host video değiştirebilir" ve "Sadece host oynatmayı kontrol edebilir" izinleri |
| 🖥️ **Tam Ekran + Sohbet** | Tam ekranda sohbet paneli görünür kalmaya devam eder |
| 🇹🇷 **Türkçe Arayüz** | Tamamen Türkçe |

---

## 📸 Ekran Görüntüleri

| Ana Sayfa (Koyu) | Video Oynatıcı | Tam Ekran + Sohbet |
|:---:|:---:|:---:|

---

## 🚀 Nasıl Kullanılır

### Hızlı Başlangıç

1. Siteye git: **[cineverse.indevs.in](cineverse.indevs.in)**
2. Kullanıcı adını yaz ve **"Oda Oluştur"** düğmesine tıkla
3. Video URL'yi yapıştır (MP4 veya M3U8 linki)
4. Oda bağlantısını kopyalayıp arkadaşlarına gönder
5. Birlikte senkron izlemeye başlayın! 🎉

### Yerel Çalıştırma

```bash
# Repo'yu klonla
git clone https://github.com/akm096/CineVerse.git
cd CineVerse

# Herhangi bir HTTP server ile aç (örnek: Python)
python -m http.server 8080

# Tarayıcıda aç
# http://localhost:8080
```

> ⚠️ **Not:** Oda sistemi (PeerJS) `file://` protokolunda çalışmaz. Yerel test için bir HTTP server kullan veya canlı siteyi kullan.

---

## 📂 Proje Yapısı

```
CineVerse/
├── index.html          # Ana sayfa (özellikler, hero)
├── player.html         # Video oynatıcı sayfası
├── css/
│   └── style.css       # Tüm stiller — dark/light tema, glassmorphism
└── js/
    ├── app.js          # Ana uygulama — oda yönetimi, ayarlar, kablolama
    ├── player.js       # Video kontrolcüsü — MP4 + HLS/M3U8
    ├── subtitles.js    # Altyazı parser — SRT, VTT, JSON
    └── chat.js         # Sohbet + emoji seçici + bildirim sesi
```

---

## 🔧 Teknik Detaylar

- **Saf statik site** — Hiçbir backend, build adımı veya Node.js gerektirmez
- **PeerJS** — P2P WebRTC tabanlı oda senkronizasyonu (ücretli cloud relay için kendi PeerServer'ını kurabilirsin)
- **HLS.js** — CDN üzerinden yüklenir, M3U8 stream desteği sağlar
- **Web Audio API** — Harici ses dosyası olmadan bildirim sesi üretir

---

## ☁️ Hosting

Proje tamamen statik olduğu için pek çok ücretsiz platformda çalışır:

### Cloudflare Pages (Önerilen) ⭐
1. Bu repo'yu fork'la
2. [pages.cloudflare.com](https://pages.cloudflare.com) → GitHub bağla → Build çıkışı: `/` (build yok)
3. Deploy → `*.pages.dev` domain ve sınırsız bant genişliği!

### GitHub Pages
1. Repo → **Settings** → **Pages** → Branch: `main` → `/` (root)
2. `https://akm096.github.io/CineVerse` adresinde yayına girer

---

## 🤝 Katkıda Bulunma

Pull request'ler memnuniyetle kabul edilir! Büyük değişiklikler için önce bir issue açmanı öneririm.

---

## 📄 Lisans

[MIT](LICENSE) © 2026 CineVerse

---

<div align="center">

❤️ ile yapıldı — Kişisel kullanım için ücretsiz

</div>
