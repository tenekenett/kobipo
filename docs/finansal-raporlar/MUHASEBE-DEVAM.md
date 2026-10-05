# Muhasebe hedefi — devam notu (2026-10-01)

Hedef: muhasebe tarafını (tam defter) Kobipo'ya çekmek. Önce küçük detaylar, sonra
muhasebe motoru. Rakip incelemesi ve karşılaştırma Claude Docs'ta:

- Aposkal muhasebe incelemesi: https://claude.ai/code/artifact/5ecd9dcc-8819-4a24-b5d6-77b323fff1d4
- Kobipo ↔ Aposkal karşılaştırması: https://claude.ai/code/artifact/29e3bbc4-ce25-4fdc-8b65-e9ade0ffb50f

## Bitti

- Pano KDV kartı, fatura editöründe cari özeti, form taslağı koruma (4a17cdf).
- KDV kuralı tek yerde (`lib/raporlar/kdv-kural.ts`); Manuel/alış belgesi "Kayıtlı".
- Vergi Raporları sayfası yeniden yazıldı (`app/(dashboard)/raporlar/vergiler`):
  beyan takvimi (KDV 28 / MPHB 26, hafta sonu → Pazartesi), KDV denklemi, "beyandan
  önce" kontrol listesi, KDV tevkifatı hesapta, Muhtasar bordrodan, kişi başı maaş
  yalnız Maaş yetkisine. Ba-Bs kaldırıldı (VUK GT 565, Eylül 2024'ten beri yok).
  Kurallar CLAUDE.md'de ("Taslak yalnız GİB'e gitmemiş e-belgedir" bölümü).

- Vergi raporu inceleme düzeltmeleri (2026-10-01, ikinci tur): oran tablosunun
  matrahı ÖİV/Konaklama'yı içermiyor; "GİB'e gönderilmemiş" uyarısının KDV'si
  tevkifat düşülmüş kalem KDV'si; dönem sınırları UTC; gelen faturalar İstanbul
  gününe göre aya düşüyor (ayın 1'i önceki aya kayıyordu). İzinli çalışanın
  "bordrosu girilmemiş" uyarısı bilerek kaldı (MPHB'de eksik gün kodu 21 ile yer alır).
  Canlıda Temmuz'daki ÖTV'li test faturalarında (SAT-2026-0153/0166/0167/0172,
  ALI-2026-0011) KDV ÖTV'siz matrahtan hesaplanmış — ÖTV kuralından önceki kayıtlar.

- Fatura altı iskonto/ilave KDV'si (2026-10-02): kalem iskontoyu düşmeden
  saklıyor, rapor artık kalemi belgedeki karşılığına çeviriyor
  (`faturaAltiCarpanSql`, kural CLAUDE.md'de). İskontolu 27 belge ~5.250 TL fazla
  sayılıyordu; "iskontosuz 8.350 TL fark" sanılan ALI-2026-0020 aslında fatura altı
  İLAVELİ belgeydi (aynı hata, ters yön). Gerçek müşteride: Eren Forklift Eylül alışı
  ORS2026000000886 → indirilecek KDV 83,04 TL fazlaydı (Eylül beyanı 28 Ekim'de).
  Kayıtlı kalemler bilerek düzeltilmedi (kullanıcı kararı). Ölçüm:
  `npm run test:canli -- lib/raporlar/kdv-kural` (salt okur; eski kodda düştüğü görüldü).
- Satış/alış raporunun kalem ve ürün bölümleri de aynı kurala bağlandı
  (2026-10-02): kuralın TS karşılığı `lib/raporlar/fatura-alti.ts` (birim testte
  document-totals ile karşılaştırılıyor). "Detaylı Faturalar"da yeni sütun
  "Fatura Altı İsk."; ürünlerde tutar/KDV belgedeki hâliyle, "Son Alış Fiyatı"
  artık ÖDENEN birim fiyat (iskontolar düşülmüş — ortalamayla aynı ölçü). Fark
  uyarısı yeniden yazıldı: eskisi iskontonun KDV'sini "uyuşmayan belge" diye
  yazıyordu; şimdi belge yuvarlaması / uyuşmayan belge (belge belge sayılıyor) /
  kuruş ayrı. Canlıda düzeltme sonrası tüm firmalarda kalem = fatura sayfası
  (≤ 6 kuruş; Reypo alışındaki 122.227 TL test belgelerinin yuvarlaması). Ölçüm:
  `npm run test:canli -- lib/raporlar` (üç dosya, salt okur, ~30 sn).

- Panoda "Nakit kaç gün yeter" kartı (2026-10-02): `components/dashboard/nakit-yeterlilik-karti.tsx`.
  Rakam Nakit Akışı raporunun hesabından (`computeCashFlow`, son 90 gün; geçmiş
  kısaysa ilk hareketten): nakit = kasa + banka + kredi kartı, çıkış = fatura
  ödemeleri + faturasız gider (virman hariç), BRÜT — "hiç tahsilat gelmezse".
  Gün yazılmayan durumlar saf modülde (`nakit-yeterlilik-hesap.ts`): nakit ≤ 0,
  30 günden kısa geçmiş, 90 günde 3'ten az çıkış kaydı (Eren ana firma: 3,2 M
  nakit, tek 580 TL çıkış → "1.300 yıl" derdi). > 365 gün "1 yıldan uzun".
  Kart Nakit & Banka raporunu açabilene çizilir. Canlıda: EREN VİNÇ 218 gün;
  kasası eksi 4 firma "Nakit yok".

- Genel kayıt araması (2026-10-02): üst çubuktaki arama kutusu menü sayfalarının
  yanında cari (ad/kod/VKN/telefon/e-posta), belge no (fatura/fiş/iade + e-belge
  no), ürün (ad/kod/barkod), teklif no, çek/senet no ve personel bulur. Uç
  `GET /api/arama`, sorgu `lib/arama/kayit-arama.ts`, kurallar
  `kayit-arama-kural.ts` (testli). Yetki: kaydın LİSTE sayfası (rol + kısıt +
  modül) VE detay sayfası (`canAccessRoute`) — fatura önizlemesinin sahibi satış
  ve alış listesi ortak olduğu için yalnız detaya bakmak yetmezdi. Cari
  görünürlüğü sorguda. Türkçe duyarsız (`trFoldAnyLike`); tam eşleşme > başlayan
  > içeren. Hesap kodu BİLEREK yok: hesap planını canlıda tek firma kullanıyor
  (3 hesap) ve Kebir hesap parametresi almıyor — muhasebe motoruyla gelecek.

- Muhasebe motoru 1. faz (2026-10-02): plan `docs/muhasebe/MOTOR-PLAN.md`. Tekdüzen
  hesap planı verisi (`lib/muhasebe/tekduzen.ts`), belge → dengeli taslak fiş kural
  motoru (`lib/muhasebe/fis-kurallari.ts`, 22 test, canlıda 630/630 belge tutuyor),
  şema + migrasyon `20261002000002_muhasebe_motoru.sql` (UYGULANMADI).

## Sırada

1. ~~Muhasebe motoru 2. faz~~ → **2., 3. ve 4. faz 2026-10-04'te yazıldı** (main e0ac9f2;
   kapsam kullanıcı kararı: 2 + 3 + 4; şube kararı: modül yalnız ana firmada).
   DEVAM NOTU: `docs/muhasebe/MOTOR-PLAN.md` → "▶ DEVAM" — yeni bilgisayarda ilk adımlar,
   sıradaki iş, açık kararlar, plandan sapmalar.
2. **2026-10-04 gece:** uçtan uca koşuldu, hatalar düzeltildi (toplu yazma, satırsız fiş,
   mizan taslak dengesi, ekran yükleme durumları). Modül satışta KAPALI; sırada veri modeli
   eksikleri (işveren SGK, ciro tarihi, virman kimliği, kur — migrasyon, önce sor), sonra
   toplu eşleme ekranı, mobil, pilot.
3. **2026-10-05:** `8ecffe1` incelemesinin düzeltmeleri + fiş kilidi (onay yarışı kapandı) +
   **toplu eşleme ekranı** (`/muhasebe/fisler/eslesme`) + **veri modeli eksikleri** (işveren SGK,
   çek/senet durum tarihi, virman kimliği, döviz kuru — migrasyon `20261005000001` canlıda).
   Uçtan uca 72/72. Mobil (390 px) tarandı: fiş detayında onay düğmeleri kırpılıyor + eşlemede
   anahtarsız grup notu — aynı akşam düzeltildi ve 390 px'te yeniden ölçüldü; ayrıntı
   `docs/muhasebe/MOTOR-PLAN.md` → "▶ DEVAM". Sıradaki: pilot.

## Ölçüm yolları

- KDV/tevkifat/muhtasar: rapor fonksiyonlarını bağımsız SQL ile karşılaştır
  (canlıda salt okuma; 2026-10-01'de tüm firma × aylar eşleşti).
- `npm run test:canli -- lib/cari/bakiye-tutarlilik lib/otomasyon/veri/sorgu`
