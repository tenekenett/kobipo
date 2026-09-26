# ÖKC bulut entegrasyonu — plan (2026-09-24)

Araştırma ve gerekçe: `ARASTIRMA.md`. Karar: **bulut (TSM) yolu.** Kablo mevzuat gereği her
müşteride kurulum ister (GMP-3 §3.3). İlk sağlayıcı **Token (Beko)**: doküman açık, simülatör var.
Kullanıcının cihazı başka markaysa (Pavo/Ödeal) sıra değişir, katman aynı kalır.

Kullanıcının şartları: **hız** (Öde → cihaz ekranında tutar ≤ 2 sn) ve **müşteri başına kurulum yok**.

---

## A. Kullanıcı (işletme) tarafı

### Tek seferlik (kendi kendine, ~5 dk)
1. Uyumlu cihaz: bulut entegrasyonu destekleyen Token'lı Beko (hangi modeller → Token'a soru 1).
2. Token tarafında izin: GMP-3 §2'ye göre sipariş verisi TSM'de 5 yıl tutuluyor ve bunun için
   "mükellefin yazılı muvafakati" gerekiyor. Muhtemelen Token'ın sözleşmesinde tek imza (soru 2).
3. Kobipo → Ayarlar → **Yazarkasa** → "Cihaz ekle" → cihaz ekranındaki **QR'ı okut** (telefon kamerası)
   ya da terminal no'yu yaz. Kobipo cihazı Token'dan doğrular.
4. **Kısım eşleme:** Kobipo cihazın kısımlarını okur (`/fiscalParameters`) ve KDV oranına göre
   önerir (%1 / %10 / %20). Kullanıcı yalnız onaylar.
5. **Kip:** kasa (anında ödeme) ya da masa (liste). Şubede birden çok cihaz olabilir.
6. **Bağlantı testi:** Kobipo 1 kalemlik sepet yollar → kullanıcı cihazda "iptal"e basar → yeşil tik.
   Mali fiş basılmaz, iz kalmaz.

### Günlük kullanım
- **Kasa:** "Öde" → cihaz ödeme ekranını kendisi açar → kart/nakit → fiş basılır → Kobipo'da satış
  kendiliğinden kapanır (stok, cari, kasa/banka). Kasiyer tutar yazmaz.
- **Masa:** "Hesap iste" → sepet o an cihaz listesine düşer → garson cihazı masaya götürür, adisyonu
  seçer, öder → Kobipo'da masa boşalır.
- **İnternet yoksa:** cihaza elle giriş (bugünkü gibi) + Kobipo'da "Cihaza elle girdim" düğmesi.
  Sessiz boşluk olmaz, gün sonu bu satışları ayrı gösterir.
- **Gün sonu:** cihazdan Z raporu (değişmez) → Kobipo Z no'ya göre kendi toplamını yan yana koyar.

---

## B. Bizim taraf — kod dışı (hemen başlar, kodu bloklar)

1. **Token'a başvuru** (developer ekibi):
   - test `client-id`/`client-secret`, simülatör erişimi, mümkünse test cihazı
   - ticari koşullar (entegratör ücreti var mı), canlı kimlik süreci
   - **sorular:** (1) hangi modeller bulut destekli (300TR? X30TR? 400TR?) (2) mükellef muvafakati
     nasıl alınıyor (3) cihazda entegrasyon kipini kim açıyor — kullanıcı mı, Token uzaktan mı
     (4) EKÜ no nereden okunur (5) iade/iptal akışı (6) fatura isteyen müşteride bilgi fişi numarası
     döner mi (7) webhook imzası / kaynak IP'leri (8) canlıda IP beyaz listesi istiyor mu
     (9) cihaza sepet ulaşma süresi (push mu, yoklama mı) (10) bir sepete cihazda birden çok ödeme
     alınabiliyor mu, `paymentItems` önceden doluysa cihaz onları sırayla mı alıyor (11) çok ödemeli
     sepette bir kart reddedilirse sepet ne durumda kalıyor (12) kip (anında / liste) kullanıcı
     tarafından değiştirilebiliyor mu
2. **Fiyat / modül kararı:** ÖKC ayrı ücretli modül mü, Restoran'a dahil mi (rakip: Adisyo 565 ₺/ay).
3. **Pilot işletme:** gerçek cihazla ölçüm ve ilk kullanım.

---

## C. Bizim taraf — kod (fazlar)

### Faz 0 — Ölçüm (Token test kimliği gelince, 1 gün)
`scripts/okc-token-olcum.ts`: auth → `instantBasket` → webhook'a kadar süre. Webhook için herkese
açık adres gerekiyor (Vercel preview). **Hız hedefi burada rakamla doğrulanır**, sonra devam edilir.

### Faz 1 — Veri modeli (migrasyon + RLS)
- `OkcDevice` — `companyId` (şube bazlı), `provider` (TOKEN | PAVO | ODEAL), `terminalId`,
  `merchantId`, `branchId`, `serialNo`, `name`, `mode` (INSTANT | LIST), `sectionMap` (KDV → kısım),
  `ekuNo?`, `active`. Firma bazlı anahtarı olan sağlayıcılar için (Pavo/Ödeal) şifreli alan
  (`lib/crypto/secrets.ts`). Token kimliği entegratör düzeyinde, env'de.
- `OkcBasket` — `id` = Token'a giden `basketID` (UUID, tekrar gönderimde çift basımı önler),
  `companyId`, `deviceId`, `ticketId?`, `status` (SENT | LOCKED | COMPLETED | CANCELLED | FAILED |
  MANUAL), `total`, `payload`, `sentAt`, `completedAt`, **`receiptNo`, `zNo`, `deviceSerial`**,
  `payments` (TxnNo/BatchNo dahil), `invoiceId?`, `rawWebhook`, `error`.
- `Invoice`e ÖKC izi: fişten `OkcBasket`e bağ (fiş listesi ve raporlar ÖKC no'yu gösterir).
- Migrasyon sonuna `ENABLE ROW LEVEL SECURITY` (CLAUDE.md), canlıya `scripts/apply-migration.js`.

### Faz 2 — Sağlayıcı katmanı `lib/okc/`
- `provider.ts` arayüzü: `sendInstant`, `sendToList`, `updateBasket`, `cancelBasket`, `getBasket`,
  `listTerminals`, `fiscalParameters`, `verifyWebhook`, `parseWebhook`. e-fatura sağlayıcı deseni.
- `token-provider.ts`, `mock-provider.ts` (cihazsız geliştirme ve test; e-invoice `mock.ts` gibi).
- `basket.ts` (SAF, testli): fiş kalemleri → sepet. KDV dahil kuruş tamsayı, miktar ×1000,
  KDV ×100, kısım `sectionMap`ten. Toplam `computeInvoiceTotals(..., { receipt: true })` ile aynı
  kuraldan (Token 1103 "kalem ≠ ödeme toplamı" reddini önler). Kuruş farkı sessiz geçilmez.
- Erişim jetonu (24 sa) önbellekte; serverless örnekler paylaşmadığı için DB'de şifreli + süre.

### Faz 3 — Fiş yazımını sunucuya taşı ⚠️ en büyük ve en riskli iş
Bugün fişi TARAYICI kesiyor: `lib/satis/submit-receipt-sale.ts` → `/api/e-donusum/invoices`
(POST gövdesi route içinde, ~800 satır, oturum kullanıcısına bağlı) → ödeme parçaları → `kapat`.
ÖKC'de "ödendi" haberi webhook ile **sunucuya** gelir, ekran açık olmayabilir (masada garson öder).
- POST'un fiş yolu `lib/invoice/create-receipt.ts` gibi bir fonksiyona çıkarılır; route onu çağırır
  (davranış değişmez, mevcut testler + uçtan uca doğrulama). Oturum yerine açık `actor` alır.
- Tahsilat parçaları ve adisyon kapanışı da aynı işlemde sunucuda.
- Mevcut ekranlar (ÖKC'siz firmalar) aynı fonksiyondan geçer → tek fiş yolu kuralı korunur.

### Faz 4 — Gönderim ucu ve hız yolu
`POST /api/okc/sepet` (hafif): adisyon/sepet → `OkcBasket` yaz → sağlayıcıya gönder → dön.
Ağır iş YOK (fiş, stok, cari yok). Hedef: bizim payımız < 500 ms.
- Kasa: "Öde" → `sendInstant`. Masa: "Hesap iste" (`billRequestedAt`) → `sendToList`.
- Adisyon sepet gittikten sonra kalem alırsa `updateBasket`; cihazda kilitliyse (1018) ekran söyler.

### Faz 5 — Webhook ucu
`POST /api/okc/webhook/[provider]`: imza/`callbackAuth` doğrulama → `basketID` ile idempotent →
- `COMPLETED` → Faz 3 fonksiyonu: fiş + tahsilat (cihazın ödeme kırılımıyla) + ÖKC no'ları + adisyon kapanır
- `CANCELLED` / red → sepet düşer, adisyon açık kalır
- `99 fiş iptal` → Kobipo fişi iptal akışı
- **Kaçan webhook:** bekleme ekranı açıkken `getBasket` ile yoklar (cron gerekmez; cron ertelendi).
  Ekran kapalıysa masa planı/adisyon listesi açılışında bekleyen sepetler sorulur.

### Faz 6 — Ekranlar
- Ayarlar → Yazarkasa: cihaz ekle (QR / terminal no), kısım eşleme, kip, bağlantı testi.
- Kahveci + Hızlı Satış: "Öde" → "Cihaza gönderildi" kartı (canlı durum, İptal, "Elle girdim").
- Adisyon + masa planı: "Cihazda ödeniyor" durumu/rengi.
- Fiş listesi: ÖKC fiş no / Z no sütunları. Mali fişi basılmış Kobipo fişinin iptali serbest değil.

### Hesap bölme (Faz 5–6 ile birlikte)
Bugün (docs/restoran/SATIS-EKRANI.md K5): "Hesabı böl" = **ödemede bölme** — fiş TEK, tahsilat
çok parçalı. Gerçek bölme (ayrı fiş) F4 olarak açık karar ("bir masada tek açık adisyon", API 409).
- **Eşit bölme / herkes kendi kartıyla, tek fiş:** TEK sepet, TEK mali fiş, cihazda N ödeme.
  Kalem bilgisi gerekmediği için garson cihazda kendisi yapabilir; webhook `paymentItems`
  kırılımını getirir, Kobipo N tahsilat yazar (altyapı var). Token soru 10–11.
- **Herkes kendi aldığını, ayrı fiş / biri erken kalkıyor:** bölme KOBİPO'DA yapılır, her parça
  ayrı sepet → ayrı mali fiş. Cihazda bölünemez çünkü webhook kalem listesi döndürmüyor —
  hangi kalemin ödendiğini bilemeyiz, stok ve rapor bozulur. F4 kararını öne çeker
  (alt adisyon: her parça kendi `invoiceId`'si; `mergedIntoId` deseninin tersi).
- Sepet listeye gittikten sonra bölünürse eski sepet silinir (`DELETE /basket`), parçalar gider;
  cihazda açıksa (1018) ekran "cihazda açık" der.
- Adisyon iskontosu parçalara orantılı dağılır; ikram satırları fişe girmez (bugünkü kural).
- Eşit bölüp herkese ayrı fiş (0,25 pizza) önerilmez; belge isteyen müşteriye tek fiş ya da e-Arşiv.

### Faz 7 — Gün sonu ve sonrası
- Gün sonu raporu: Z no bazında toplam + "elle girilen" satırlar ayrı.
- Fatura isteyen müşteri: ÖKC bilgi fişi + e-Arşiv referansı (Mysoft `invoiceOutbox`ta alan yok,
  bkz. ARASTIRMA.md). Token'ın cevabı gelmeden başlanmaz.
- Pavo / Ödeal sürücüleri (katman hazır, yalnız sürücü).

---

## Sıra ve bağımlılık

> **2026-09-24 kararı:** önce Kobipo tarafı → `ASAMA1-KOBIPO.md` (cihaz tanımı, Z no/EKÜ,
> Z mutabakatı, gerçek hesap bölme, fiş yolunu sunucuya taşıma). Aşağıdaki Faz 1 ve Faz 3 oraya
> taşındı; bu dosya Aşama 2'dir (POS). Kullanıcı test cihazını getirecek.

```
B1 Token başvurusu ──► Faz 0 ölçüm ──► (hız tutuyorsa) ──► Faz 4-5-6 ──► pilot
Faz 1 + Faz 2 (mock) + Faz 3 ── başvuruyu BEKLEMEZ, hemen başlanabilir ──┘
```

---

## Worldline (Ingenico) yol haritası — 2026-09-25

Kullanıcının cihazı Ingenico iDE280 → ilk entegre marka Worldline, kablosuz (TSM) yolu:
Worldline'ın TSM sunucusu Kobipo'dan açık adisyonları çeker, işletmede kurulum yok.
Gerekçe ve rakip incelemesi: `ARASTIRMA.md` → "Kullanıcının cihazı: Ingenico iDE280".
Diğer markalar yalnız müşteri talebiyle; o zamana kadar hepsi Aşama 1 elle akışıyla çalışır.

| # | Adım | Kim | Çıktı |
|---|---|---|---|
| W0 | iKasa'ya cihaz seri no + telefonla gir; GMP3 Hizmet Bedeli ekranında "Kablosuz" var mı, fiyat ne (satın alma yok). Worldline'ı ara (0 850 250 40 30), entegrasyon ekibine ulaş | Kullanıcı | iDE280 kablosuz cevabı, entegrasyon ekibi kişisi |
| W1 | Entegratör başvurusu + sözleşme (muhtemelen Reypo Bilişim adına). Sorular ARASTIRMA.md'deki 8 madde + **bayi modeli**: lisansı Kobipo içinden satıp müşteri adına tanımlatabilir miyiz | Kullanıcı | Doküman, test imkânı, iKasa listesinde "Kobipo" |
| W2 | Kobipo Proxy ucu + Ayarlar → Yazarkasa kurulum sihirbazı (adım adım rehber, "bağlandı" göstergesi) | Claude | Kod; protokol HTTP değilse küçük sunucu kararı (kullanıcının) |
| W3 | Kendi cihazıyla test: iKasa'dan lisans (Kablosuz, "Kobipo"), 24 sa, cihazda parametre yükle, gerçek fiş + Z mutabakatı. iDE280 kablosuz değilse Worldline'dan test cihazı | Kullanıcı + Claude | Uçtan uca doğrulama |
| W4 | 1–2 pilot restoran, kurulumda yanında ol; nerede takıldıklarını not et | Kullanıcı | Rehberin düzeltilmesi |
| W5 | Kendi kendine kurulum: müşteri lisansı alır (ya da Kobipo'dan, W1 bayi cevabına göre) → parametre yükler → Kobipo'da seri no girer → ilk TSM çağrısında "bağlandı" | Müşteri | Kullanıcı yalnız destekte |

Müşterinin tek dış adımı lisans alımı; bayi modeli olursa o da Kobipo içine girer.
