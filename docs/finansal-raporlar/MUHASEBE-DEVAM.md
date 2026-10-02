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

## Sırada

1. Nakit "kaç gün yeter" göstergesi (panoda).
2. Genel kayıt araması.
3. Muhasebe motoru: belge → öğrenen taslak yevmiye fişi → onay (Aposkal'ın güçlü
   yanı; ayrıntı yukarıdaki dokümanlarda, "Kobipo için çıkarımlar").

## Ölçüm yolları

- KDV/tevkifat/muhtasar: rapor fonksiyonlarını bağımsız SQL ile karşılaştır
  (canlıda salt okuma; 2026-10-01'de tüm firma × aylar eşleşti).
- `npm run test:canli -- lib/cari/bakiye-tutarlilik lib/otomasyon/veri/sorgu`
