-- ALIŞ BELGESİ NUMARASI TEDARİKÇİ BAZINDA TEKİL (karar C, 2026-09-21; plan §3.6).
--
-- NEDEN: `invoices(companyId, invoiceNo)` tekil kısıtı alışta TEDARİKÇİNİN
-- numarasını tutuyor. e-Arşiv numarası 3 harf seri + yıl + 9 hane; seri harfleri
-- firmaya özel DEĞİL — iki tedarikçi aynı numarayı üretebilir ("ABC2026000000001").
-- İkincisi P2002 → 409 "Bu Fatura No bu firmada zaten kayıtlı" ile reddediliyordu:
-- yanlış mesaj, yanlış kural. Belge tarama ile dış numaralı alış belgesi hacmi
-- artacağı için çakışma olasılığı da artar.
--
-- KURAL:
--   • Satış / iade (bizim serimiz): firma içinde tekil — değişmedi.
--   • Alış: (firma, tedarikçi, no) tekil. Tedarikçisiz alış belgeleri kendi
--     aralarında tekil (NULLS NOT DISTINCT; Postgres 15+ — proje 17'de).
-- Aynı kural irsaliyeye de uygulanır: `waybills(companyId, waybillNo)` alışta
-- tedarikçinin irsaliye numarasını taşıyor (uç "elle girilen no öncelikli" diyor).
--
-- Mevcut veri etkilenmez: eski kısıt daha DAR olduğu için yeni kısıtları ihlal
-- eden satır olamaz. Prisma tarafında @@unique → @@index (kısmi indeks Prisma
-- şemasında ifade edilemiyor; P2002 yine üretilir, çakışma yakalama değişmez).

DROP INDEX IF EXISTS public."invoices_companyId_invoiceNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_companyId_invoiceNo_own_key"
  ON public.invoices ("companyId", "invoiceNo")
  WHERE "type" <> 'PURCHASE';

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_purchase_supplier_no_key"
  ON public.invoices ("companyId", "supplierId", "invoiceNo") NULLS NOT DISTINCT
  WHERE "type" = 'PURCHASE';

-- Numara ile arama (mükerrer denetimi, listeler) kısmi indekslerden bağımsız.
CREATE INDEX IF NOT EXISTS "invoices_companyId_invoiceNo_idx"
  ON public.invoices ("companyId", "invoiceNo");

DROP INDEX IF EXISTS public."waybills_companyId_waybillNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "waybills_companyId_waybillNo_own_key"
  ON public.waybills ("companyId", "waybillNo")
  WHERE "type" <> 'PURCHASE';

CREATE UNIQUE INDEX IF NOT EXISTS "waybills_purchase_supplier_no_key"
  ON public.waybills ("companyId", "supplierId", "waybillNo") NULLS NOT DISTINCT
  WHERE "type" = 'PURCHASE';

CREATE INDEX IF NOT EXISTS "waybills_companyId_waybillNo_idx"
  ON public.waybills ("companyId", "waybillNo");
