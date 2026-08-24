-- Kobipo'nun KENDİ satışlarının (kontör + paket/abonelik) otomatik faturalandırılması.
-- Plan: docs/faturalandirma/PLAN.md
--
-- Üç grup kolon eklenir:
--   1) KDV: paket fiyatları KDV DAHİL tutulur; oran paket bazında override edilebilir,
--      NULL ise sistem varsayılanı (%20) kullanılır.
--   2) Sipariş → fatura bağı + fatura bilgisi snapshot'ı. `invoiceId` UNIQUE'tir ve
--      çift-fatura kilidi olarak kullanılır: servis `invoiceId IS NULL` koşuluyla claim
--      eder, PayTR'ın tekrar gönderdiği bildirim count=0 alıp çıkar.
--   3) `isTest`: PayTR test ödemesinde para ÇEKİLMEZ ama callback success döner ve kontör
--      gerçekten yüklenir. Tahsil edilmemiş satış için GİB'e gerçek belge gitmesin diye
--      fatura kesilmez; bayrak sipariş anında snapshot'lanır (env sonradan değişse geçmiş
--      siparişler etkilenmesin).
--
-- MEVCUT KAYITLAR: `isTest` geriye dönük DOLDURULMAZ. Geçmiş siparişlerin gerçek mi test
-- mi olduğu buradan güvenilir şekilde bilinemez (canlı ortamın PAYTR_TEST_MODE değeri
-- ayrı); tarihsel kayıtları faturalandırmadan koruyan asıl mekanizma servisteki
-- KOBIPO_AUTO_INVOICE_START_AT tarih kapısıdır — bu migrasyon o kapıyı ikame etmez.
--
-- Yeni TABLO yok (yalnız kolon) → RLS ifadesi gerekmez; ilgili tablolar
-- 20260811000003_rls_lockdown.sql ile zaten açık ve policy'siz.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- 1) İNTERNET SATIŞI ------------------------------------------------------------------

-- GİB, internet üzerinden yapılan satışın e-Arşiv faturasını ayrı numaratörden bekler
-- (Mysoft'ta isInternetSales=true olan seri). NULL → Mysoft varsayılanına düşülür.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "eArchiveInternetPrefix" text;

-- Mysoft InvoiceDraftModel.internetShipmentInfo karşılığı (ödeme şekli/tarihi, ödeme
-- aracısı, web adresi). NULL = normal satış, payload'a hiçbir internet alanı eklenmez.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS "internetSalesInfo" jsonb;

-- 2) KDV ------------------------------------------------------------------------------

ALTER TABLE public.kontor_packages
  ADD COLUMN IF NOT EXISTS "vatRate" numeric(5,2);

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS "vatRate" numeric(5,2);

-- 3) SİPARİŞ → FATURA -----------------------------------------------------------------

ALTER TABLE public.kontor_orders
  ADD COLUMN IF NOT EXISTS "invoiceId"        text,
  ADD COLUMN IF NOT EXISTS "invoicedAt"       timestamp(3),
  ADD COLUMN IF NOT EXISTS "invoiceError"     text,
  ADD COLUMN IF NOT EXISTS "invoiceAttempts"  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isTest"           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "billingName"      text,
  ADD COLUMN IF NOT EXISTS "billingTaxNumber" text,
  ADD COLUMN IF NOT EXISTS "billingTaxOffice" text,
  ADD COLUMN IF NOT EXISTS "billingAddress"   text,
  ADD COLUMN IF NOT EXISTS "billingCity"      text,
  ADD COLUMN IF NOT EXISTS "billingDistrict"  text,
  ADD COLUMN IF NOT EXISTS "billingEmail"     text;

ALTER TABLE public.package_orders
  ADD COLUMN IF NOT EXISTS "invoiceId"        text,
  ADD COLUMN IF NOT EXISTS "invoicedAt"       timestamp(3),
  ADD COLUMN IF NOT EXISTS "invoiceError"     text,
  ADD COLUMN IF NOT EXISTS "invoiceAttempts"  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isTest"           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "billingName"      text,
  ADD COLUMN IF NOT EXISTS "billingTaxNumber" text,
  ADD COLUMN IF NOT EXISTS "billingTaxOffice" text,
  ADD COLUMN IF NOT EXISTS "billingAddress"   text,
  ADD COLUMN IF NOT EXISTS "billingCity"      text,
  ADD COLUMN IF NOT EXISTS "billingDistrict"  text,
  ADD COLUMN IF NOT EXISTS "billingEmail"     text;

-- UNIQUE: bir fatura yalnız bir siparişe ait olabilir. NULL'lar serbesttir (Postgres
-- unique index birden çok NULL kabul eder), yani faturasız sipariş sınırsızdır.
CREATE UNIQUE INDEX IF NOT EXISTS "kontor_orders_invoiceId_key"
  ON public.kontor_orders ("invoiceId");

CREATE UNIQUE INDEX IF NOT EXISTS "package_orders_invoiceId_key"
  ON public.package_orders ("invoiceId");

-- Fatura silinirse sipariş kaybolmaz, yalnız bağ kopar (SET NULL). Sipariş ödeme
-- kaydıdır; belge yeniden kesilebilir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kontor_orders_invoiceId_fkey'
  ) THEN
    ALTER TABLE public.kontor_orders
      ADD CONSTRAINT "kontor_orders_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES public.invoices (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'package_orders_invoiceId_fkey'
  ) THEN
    ALTER TABLE public.package_orders
      ADD CONSTRAINT "package_orders_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES public.invoices (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
