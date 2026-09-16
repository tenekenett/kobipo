# Teklif iskontosu + fatura kuruş farkı — devir notu (2026-09-16)

Dal: `teklif-iskonto-kurus`. İki iş aynı dalda; birincisi bitti, ikincisi yarıda.

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

## 2. Fatura kuruş farkı — YARIDA

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

### Yapılanlar (tsc temiz, 1.211 test geçiyor — yeni kural için henüz test YOK)

- `lib/integrations/e-invoice/mysoft-provider.ts` → `computeDocumentTotals` (doğrulandı, yukarıda)
- `app/api/e-donusum/invoices/route.ts` (POST) ve `[id]/route.ts` (PUT) → `computeInvoiceTotals`
  - PUT kalem gelmezse artık KAYITLI kalemlerden hesaplıyor (eski yol saklı neti ölçeklerken genel iskontoyu 2. kez düşüyordu)
- `components/e-donusum/invoice-editor.tsx` → `computeInvoiceTotals` (düzenlenen kayıt fişse `isReceiptDoc`)
- `app/api/e-donusum/invoices/preview-pdf/route.ts` → aynı modül (ilave/yuvarlama da artık hesaba giriyor)
- `lib/teklif/quote-totals.ts` → resmî belge kuralı
- Dönüşümler başlığı kopyalamak yerine kalemlerden kuruyor (`invoiceTotalsFromStoredItems`):
  `app/api/teklif/[id]/faturaya-donustur`, `app/api/siparis/[id]/faturaya-donustur`,
  `app/api/fisler/faturaya-donustur` (+ yuvarlama satırı)

### Kalanlar

1. `lib/invoice/document-totals.test.ts` yaz: Reypo örneği (kalemler aşağıda → ödenecek 31.906,39), fiş kuralının
   eski formülle aynı kaldığı, fiş birleştirmede yuvarlama satırının tahsil edilen toplamı koruduğu, kolon hassasiyeti.
   Reypo kalemleri: 1×12.345,67 KDV20 iskonto 1.000 ₺ · 3×4.999,99 KDV20 1.250,50 ₺ · 7×83,333333 KDV10 %3 ·
   2×1.499,50 KDV1 99,99 ₺ · 1×500 KDV20 · genel 2.000 ₺ → matrah 27.059,98, KDV 4.846,41, ödenecek 31.906,39.
2. Uçtan uca: dev sunucu + fatura oluştur/düzenle (editör ekranı toplamı = kayıt), fiş satışı (kafe fişi değişmemeli),
   fişleri faturaya birleştir (yuvarlama satırı), teklif/sipariş → fatura; Reypo test hesabında Mysoft test ortamı
   `draftXmlOnly` ile `PayableAmount` = Kobipo `totalAmount` kontrolü (ölçüm yolu: `scripts/sube-adresi-kontrol.ts` deseni).
3. `scripts/test-teklif-iskonto.mjs` son adımdaki "editör formülüyle KDV" kontrolü eski oransal formülü kullanıyor;
   yeni kurala göre güncelle.
4. Karar bekliyor: mevcut (gönderilmemiş, DRAFT) faturaların toplamı yeniden hesaplansın mı? Gönderilmiş faturaya dokunulmaz.
5. Bitince CLAUDE.md'ye kısa kural bölümü: "fatura dip toplamı yalnız document-totals.ts'ten; fiş istisnası".
6. Dokunulmayanlar bilerek: `app/api/import` (kaynak XML'in resmî toplamına zaten tamamlıyor), hızlı satış/alış ve
   AI fiş okuma (fiş), `lib/invoicing/issue-sales-invoice.ts` (Kobipo'nun kendi abonelik faturası, `lib/billing/vat.ts`).
