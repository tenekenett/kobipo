-- İrsaliye kalemleri (waybill_items) tablosunda birincil anahtar dışında HİÇ
-- indeks yoktu (2026-10-01 canlıda pg_indexes ile ölçüldü). Kardeşi invoice_items'ta
-- ikisi de var. Bugün tablo küçük (11 satır) ama iki okuma yolu tabloyu baştan sona
-- tarıyordu:
--
--   "waybillId" → irsaliyenin kalemleri (irsaliye ekranı, faturaya bağlama,
--                 alış irsaliyesi stok girişi) ve irsaliye silinirken CASCADE.
--   "productId" → ürün kartındaki "Ürüne Ait Son 100 İşlem" (lib/stock/urun-islemleri.ts)
--                 ve ürün silinirken SET NULL.
--
-- Adlar Prisma'nın üreteceği adlarla AYNI (schema.prisma'daki @@index) — şema ile
-- veritabanı ayrışmasın. IF NOT EXISTS: dosya ikinci kez uygulanırsa zarar vermez.
-- CONCURRENTLY kullanılmadı: apply-migration.js dosyayı tek transaction'da çalıştırır
-- ve CONCURRENTLY transaction içinde çalışmaz; tablo küçük olduğu için kilit anlıktır.
--
-- Uygulama: node scripts/apply-migration.js supabase/migrations/20261001000001_waybill_items_indexes.sql

CREATE INDEX IF NOT EXISTS "waybill_items_waybillId_idx" ON public.waybill_items ("waybillId");
CREATE INDEX IF NOT EXISTS "waybill_items_productId_idx" ON public.waybill_items ("productId");
