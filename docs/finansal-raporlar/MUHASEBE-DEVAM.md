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

## Açık — karar bekliyor

**Fatura altı iskontolu belgede KDV kalemden fazla.** Son 12 ayda iskontolu ~30
belgede `SUM(invoice_items.vatAmount)` başlıktaki `invoices.vatAmount`tan büyük
(toplam ~5.250 TL); ayrıca iskontosuz bir faturada 8.350 TL açıklanamayan fark var.
`computeVatDeclaration` kalemleri topladığı için bu belgelerde KDV fazla çıkıyor.
Önerilen düzeltme: her belgenin kalem KDV'sini başlık oranına ölçekle (başlık
`document-totals` kaynağıdır; genel iskonto satırları eşit oranda küçültür). Ölçüm
sorgusu: invoices × invoice_items, `abs(i."vatAmount" - SUM(ii."vatAmount")) > 0.05`,
`globalDiscountAmount > 0` kırılımıyla. Düzeltmeden önce kullanıcıya sorulacak.

## Sırada

1. Nakit "kaç gün yeter" göstergesi (panoda).
2. Genel kayıt araması.
3. Muhasebe motoru: belge → öğrenen taslak yevmiye fişi → onay (Aposkal'ın güçlü
   yanı; ayrıntı yukarıdaki dokümanlarda, "Kobipo için çıkarımlar").

## Ölçüm yolları

- KDV/tevkifat/muhtasar: rapor fonksiyonlarını bağımsız SQL ile karşılaştır
  (canlıda salt okuma; 2026-10-01'de tüm firma × aylar eşleşti).
- `npm run test:canli -- lib/cari/bakiye-tutarlilik lib/otomasyon/veri/sorgu`
