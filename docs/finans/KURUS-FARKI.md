# Teklif iskontosu + fatura kuruş farkı — devir notu (2026-09-16)

Dal: `teklif-iskonto-kurus`. İki iş aynı dalda; ikisi de BİTTİ (main'e alındı).
Kalıcı kural CLAUDE.md'de: "Fatura dip toplamı YALNIZ `lib/invoice/document-totals.ts`ten gelir".

## 1. Teklif iskontosu — BİTTİ

- Satır ve genel iskonto yüzde **veya** tutar ("birim" = para tutarı; tutar satır toplamından düşer, adet başı değil).
- Şema: `Quote.globalDiscountRate` (yalnız % girilince) + `Quote.globalDiscountAmount`. Satırda mod kolonu yok:
  oran NULL + tutar dolu = tutar modu (faturadaki kural).
- Migrasyon `supabase/migrations/20260916000001_quote_global_discount.sql` **canlıya uygulandı**.
- Hesap: `lib/teklif/quote-totals.ts`, kayıt: `lib/teklif/quote-record.ts`, ekran: `components/teklif/quote-lines.tsx`
  (üç teklif ekranı da bunu kullanır; detay sayfası eski kopya editörden buna geçirildi).
- Faturaya dönüşümde genel iskonto `Invoice.globalDiscountAmount` olarak taşınır.
- Doğrulandı: Reypo Medya Ajansı'nda satış/satın alma teklifi, detay düzenleme, USD çevrimi, PDF, faturaya
  dönüşüm, Mysoft test ortamı taslak UBL. Uçtan uca betik: `node scripts/test-teklif-iskonto.mjs` (dev sunucu açıkken).

## 2. Fatura kuruş farkı — BİTTİ

### Sorun (ölçüldü)

Kobipo fatura toplamını satırların yuvarlanmamış toplamından kuruyordu (`lib/invoice/line-tax.ts`); Mysoft'a giden
belge her satırı kuruşa yuvarlıyor, genel iskontoyu satırlara dağıtıyor. 2.000 rastgele faturanın %38'inde 1–3 kuruş
fark (iskontosuzların da %39'unda). Reypo taslak UBL: Kobipo 31.906,38 ↔ belge 31.906,39. Gönderimden sonra tutar
Mysoft'tan geri okunmuyor → fark cari bakiyede kalıyor.

### Karar

- Yeni tek kaynak `lib/invoice/document-totals.ts`:
  - `computeDocumentTotals` — sağlayıcıdaki hesabın birebir taşınmış hâli. **Mysoft sağlayıcısı artık bunu kullanıyor**;
    1.500 rastgele faturada GİB'e giden payload taşımadan önce/sonra **bayt bayt aynı** çıktı (ÖTV, maktu/oransal GEKAP,
    konaklama/ÖİV, tevkifat, istisna, sıfır tutarlı kalem, genel iskonto/ilave/yuvarlama dahil).
  - `computeInvoiceTotals(lines, adj, { receipt })` — kaydedilen başlık. Resmî belge → satır yuvarlamalı (GİB ile aynı).
  - **FİŞ (`isReceipt`) eski yuvarlamasız kuralda kalır.** Sebep ölçüldü: KDV dahil fiyatlı kafe fişinde satır
    yuvarlaması 20.000 fişin 2.318'inde ekrandaki fiyattan kuruş sapıyor; eski kural 0 sapma.
  - Fişler faturaya birleşince kuruş farkı `payableRoundingAmount` ile kapatılır (tahsil edilen = belge ödenecek).
  - `documentColumnPrecision`: resmî belgede miktar 2, birim fiyat 6, tutar 2 ondalığa JS'te yuvarlanıp AYNEN yazılır
    (Postgres .xx5'i JS'ten farklı yuvarlar).

### Yapılanlar

- `lib/integrations/e-invoice/mysoft-provider.ts` → `computeDocumentTotals` (doğrulandı, yukarıda)
- `app/api/e-donusum/invoices/route.ts` (POST) ve `[id]/route.ts` (PUT) → `computeInvoiceTotals`
  - PUT kalem gelmezse artık KAYITLI kalemlerden hesaplıyor (eski yol saklı neti ölçeklerken genel iskontoyu 2. kez düşüyordu)
- `components/e-donusum/invoice-editor.tsx` → `computeInvoiceTotals` (düzenlenen kayıt fişse `isReceiptDoc`)
- `app/api/e-donusum/invoices/preview-pdf/route.ts` → aynı modül (ilave/yuvarlama da artık hesaba giriyor)
- `lib/teklif/quote-totals.ts` → resmî belge kuralı
- Dönüşümler başlığı kopyalamak yerine kalemlerden kuruyor (`invoiceTotalsFromStoredItems`):
  `app/api/teklif/[id]/faturaya-donustur`, `app/api/siparis/[id]/faturaya-donustur`,
  `app/api/fisler/faturaya-donustur` (+ yuvarlama satırı)

- `invoiceTotalsFromStoredItems` satır iskontosunu **kayıtlı `discountAmount`tan** okur (sağlayıcı belgeye o kolonu
  yazar); oran yalnız tutar kolonu boş eski kayıtta devreye girer. Orandan türetmek .xx5'te (Postgres yukarı,
  JS aşağı yuvarlar) başlığı belgeden bir kuruş ayırırdı.

### Doğrulama (2026-09-16, tamamlandı)

1. `lib/invoice/document-totals.test.ts` — 17 test: Reypo örneği (ödenecek 31.906,39, satır payları, GİB dip toplam
   denklemi), satır↔toplam yuvarlama farkı örneği (7 × 83,333333 × 2 → 1.283,32 / 1.283,33), fiş kuralının eski formülle
   birebir aynı kaldığı, KDV dahil fiyatlı kafe fişinin ekrandaki tutarı verdiği, fiş birleştirmede yuvarlama satırının
   tahsil edilen toplamı koruduğu, kolon hassasiyeti, gönderim seçenekleri, kayıtlı iskonto tutarının orana üstünlüğü.
2. `node scripts/test-fatura-kurus.mjs` (dev sunucu açıkken, Demo Firma; 37/37): fatura POST (Reypo → 31.906,39,
   %3 iskonto 17,50 kaydedildi), PUT kalemsiz (toplam değişmedi — iskonto ikinci kez düşmüyor), PUT kalemsiz genel iskonto
   değişimi (kayıtlı kalemlerden), PUT kalemli, fiş (222,50 + 7,90; birim fiyat yuvarlanmadı), fişler → fatura
   (ödenecek 230,40 = tahsil edilen, yuvarlama −0,01), sipariş → fatura (sipariş 1.283,33 kayıtlı, fatura 1.283,32).
   Oluşturulan kayıtlar silinir.
3. `npx tsx scripts/kurus-farki-kontrol.ts` (offline, 8/8) ve `--canli --test` (Mysoft test ortamı taslak UBL, 7/7):
   belgede `PayableAmount` 31.906,39 = Kobipo `totalAmount`; `TaxExclusiveAmount`/`TaxTotal`/`LineExtensionAmount`/
   `AllowanceTotalAmount` da Kobipo başlığıyla aynı.
4. `scripts/test-teklif-iskonto.mjs` son adım ("editör formülüyle KDV") yeni kurala güncellendi; 34/34.

### Bilinen kenar (düzeltilmedi, ölçüldü)

Genel iskonto ara toplamın TAMAMI kadarsa (sıfır ₺'lik fatura) ve satır brütü .xx5'te bitiyorsa
(ör. 2 × [3 × 33,335]) satır matrahı −0,01/+0,01 çıkabiliyor: paylar yuvarlanmamış ara toplamdan, satır
matrahı yuvarlanmamış brütten düşülüyor. Sağlayıcının eski kopyasında da aynıydı; algoritmayı değiştirmek GİB'e
giden payload'ı değiştireceği için ölçülmeden dokunulmadı. Gerçek kullanımda %100 genel iskontolu fatura yok.

### Karar (2026-09-16): mevcut DRAFT faturalara DOKUNULMAZ

Eski kuralla kaydedilmiş DRAFT faturalar toplu yeniden hesaplanmaz. Düzenlenip kaydedilen DRAFT zaten yeni
kurala geçer; dokunulmayan DRAFT eski toplamla durur ve gönderilirken belge 1–3 kuruş farklı çıkabilir — bu
bilinçli kabul edildi. Gönderilmiş faturaya hiçbir durumda dokunulmaz.

### Dokunulmayanlar (bilerek)

`app/api/import` (kaynak XML'in resmî toplamına zaten tamamlıyor), hızlı satış/alış ve AI fiş okuma (fiş),
`lib/invoicing/issue-sales-invoice.ts` (Kobipo'nun kendi abonelik faturası, `lib/billing/vat.ts`).
