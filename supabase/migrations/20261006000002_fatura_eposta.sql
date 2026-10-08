-- Fatura e-postası (2026-10-06): giden e-belge carinin e-postasına, gelen e-fatura
-- hesabı açan kişinin giriş e-postasına gider. Kural: lib/fatura-eposta/.
--
-- DEPLOY'DAN ÖNCE uygulanır — yeni Prisma istemcisi firma ve gelen fatura okurken yeni
-- kolonları seçer, kolon yoksa ekranlar düşer. Tekrar çalıştırılabilir.
--
-- BAŞLANGIÇ ÇİZGİSİ: migrasyon anında var olan her giden e-belgeye ve gelen faturaya
-- "BASLANGIC" yazılır. Yazılmasaydı ilk koşum binlerce eski faturayı müşterilere ve
-- firma sahiplerine mail olarak dökerdi. Migrasyon ile deploy arasında eski kodla
-- gelen/giden belgeler işaretsiz kalır ve yeni kodun ilk koşumunda gönderilir — bunlar
-- gerçekten yeni belgelerdir.

-- 1) Firma anahtarları (varsayılan açık)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "invoiceEmailAuto" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "incomingEmailNotify" boolean NOT NULL DEFAULT true;

-- 2) Gelen fatura bildirim durumu
ALTER TABLE public.incoming_invoices
  ADD COLUMN IF NOT EXISTS "notifiedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "notifyResult" text,
  ADD COLUMN IF NOT EXISTS "notifyAttempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notifyError" text;

CREATE INDEX IF NOT EXISTS "incoming_invoices_notifiedAt_idx"
  ON public.incoming_invoices ("notifiedAt");

UPDATE public.incoming_invoices
   SET "notifiedAt" = now(), "notifyResult" = 'BASLANGIC'
 WHERE "notifiedAt" IS NULL;

-- 3) Giden fatura e-posta kaydı
CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
  id text PRIMARY KEY,
  "companyId" text NOT NULL,
  "invoiceId" text NOT NULL,
  "autoKey" text,
  kind text NOT NULL,
  recipient text,
  status text NOT NULL,
  error text,
  "messageId" text,
  attempts integer NOT NULL DEFAULT 0,
  "createdBy" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_email_logs_invoiceId_fkey'
  ) THEN
    ALTER TABLE public.invoice_email_logs
      ADD CONSTRAINT "invoice_email_logs_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES public.invoices(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_email_logs_autoKey_key"
  ON public.invoice_email_logs ("autoKey");
CREATE INDEX IF NOT EXISTS "invoice_email_logs_invoiceId_createdAt_idx"
  ON public.invoice_email_logs ("invoiceId", "createdAt");
CREATE INDEX IF NOT EXISTS "invoice_email_logs_status_updatedAt_idx"
  ON public.invoice_email_logs (status, "updatedAt");

ALTER TABLE public.invoice_email_logs ENABLE ROW LEVEL SECURITY;

-- Başlangıç çizgisi: GİB'e gitmiş her satış/iade e-belgesi "otomatik mail hakkını
-- kullanmış" sayılır. Alış faturası (type PURCHASE) bizim kestiğimiz belge değildir.
INSERT INTO public.invoice_email_logs
  (id, "companyId", "invoiceId", "autoKey", kind, status, "createdAt", "updatedAt")
SELECT 'bsl_' || i.id, i."companyId", i.id, i.id, 'AUTO', 'BASLANGIC', now(), now()
  FROM public.invoices i
 WHERE i.status = 'SENT'
   AND i."invoiceType" IN ('E_INVOICE', 'E_ARCHIVE')
   AND i.type <> 'PURCHASE'
ON CONFLICT DO NOTHING;
