-- İNDİRİM KODLARI — Kobipo'nun kendi satışları (kontör paketi + abonelik/paket).
--
-- İki tablo:
--   discount_codes             → kodun tanımı ve sınırları (yüzde/tutar, kapsam,
--                                tarih aralığı, kullanım hakkı, yenilemede geçerlilik)
--   discount_code_redemptions  → KULLANIM kaydı. Limitler buradan sayılır ve satır
--                                YALNIZ ödeme başarılı olduğunda yazılır; yarım kalan
--                                sipariş kimsenin hakkını yemez.
--
-- Sipariş tablolarına eklenen alanlar: uygulanan kodun id'si, kod metninin sipariş
-- anı snapshot'ı (kod sonradan silinse de belgede/raporda kalsın) ve indirim tutarı.
-- `kontor_orders.totalPrice` ile `package_orders.amount` TAHSİL EDİLEN tutardır;
-- liste tutarı `+ discountAmount` ile bulunur — fatura kalemi liste fiyatından
-- yazılıp iskonto ayrı işlenir.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id                  text PRIMARY KEY,
  code                text NOT NULL,
  description         text,
  type                text NOT NULL,
  value               numeric(10, 2) NOT NULL,
  scope               text NOT NULL DEFAULT 'ALL',
  "maxDiscount"       numeric(10, 2),
  "minAmount"         numeric(10, 2),
  "startsAt"          timestamp(3) without time zone,
  "endsAt"            timestamp(3) without time zone,
  "maxRedemptions"    integer,
  "maxPerCompany"     integer DEFAULT 1,
  "appliesToRenewals" boolean NOT NULL DEFAULT false,
  "isActive"          boolean NOT NULL DEFAULT true,
  "createdAt"         timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "discount_codes_code_key"
  ON public.discount_codes (code);
CREATE INDEX IF NOT EXISTS "discount_codes_isActive_idx"
  ON public.discount_codes ("isActive");

CREATE TABLE IF NOT EXISTS public.discount_code_redemptions (
  id               text PRIMARY KEY,
  "codeId"         text NOT NULL,
  "companyId"      text NOT NULL,
  "orderKind"      text NOT NULL,
  "kontorOrderId"  text,
  "packageOrderId" text,
  amount           numeric(10, 2) NOT NULL,
  "isRenewal"      boolean NOT NULL DEFAULT false,
  "createdAt"      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Aynı sipariş iki kez sayılmasın: PayTR aynı bildirimi tekrar gönderebilir.
-- (Postgres'te UNIQUE, birden çok NULL'a izin verir — kodsuz siparişler etkilenmez.)
CREATE UNIQUE INDEX IF NOT EXISTS "discount_code_redemptions_kontorOrderId_key"
  ON public.discount_code_redemptions ("kontorOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "discount_code_redemptions_packageOrderId_key"
  ON public.discount_code_redemptions ("packageOrderId");
CREATE INDEX IF NOT EXISTS "discount_code_redemptions_codeId_companyId_idx"
  ON public.discount_code_redemptions ("codeId", "companyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'discount_code_redemptions_codeId_fkey'
  ) THEN
    ALTER TABLE public.discount_code_redemptions
      ADD CONSTRAINT "discount_code_redemptions_codeId_fkey"
      FOREIGN KEY ("codeId") REFERENCES public.discount_codes (id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'discount_code_redemptions_companyId_fkey'
  ) THEN
    ALTER TABLE public.discount_code_redemptions
      ADD CONSTRAINT "discount_code_redemptions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES public.companies (id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Sipariş tablolarındaki indirim alanları.
ALTER TABLE public.kontor_orders
  ADD COLUMN IF NOT EXISTS "discountCodeId" text,
  ADD COLUMN IF NOT EXISTS "discountCode"   text,
  ADD COLUMN IF NOT EXISTS "discountAmount" numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.package_orders
  ADD COLUMN IF NOT EXISTS "discountCodeId" text,
  ADD COLUMN IF NOT EXISTS "discountCode"   text,
  ADD COLUMN IF NOT EXISTS "discountAmount" numeric(10, 2) NOT NULL DEFAULT 0;

-- CLAUDE.md → "Yeni tablo → RLS açılacak": public şemadaki her tablo RLS AÇIK ve
-- POLICY'SİZ (default deny) tutulur; veriye erişimin tek yolu uygulamanın postgres
-- bağlantısıdır. Supabase Data API'si kazara açılırsa devreye giren ikinci duvar.
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_code_redemptions ENABLE ROW LEVEL SECURITY;
