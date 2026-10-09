-- Muhasebe eksik turu (docs/muhasebe/MOTOR-PLAN.md → "2026-10-09 eksik turu").
--
-- 1) Kasa/banka hareketinin TÜRÜ ve avansın çalışanı. NULL olabilir: NULL = olağan
--    gelir/gider (bugünkü bütün kayıtlar). Eski kod kolonları okumaz; yeni Prisma istemcisi
--    seçer — bu yüzden DEPLOY'DAN ÖNCE uygulanır. Tekrar çalıştırılabilir.
--      KDV / TAX  vergi ödemesi      → muhasebede 360 (gider değil, borcun ödenmesi)
--      SGK        prim ödemesi       → 361
--      ADVANCE    personel avansı    → 196 (employeeId zorunlu — uygulama denetler)
--      LOAN       kredi              → 300
--      PARTNER    ortak              → 331 / 131
--    Kural: lib/finans/hareket-turu.ts.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS "employeeId" text;
CREATE INDEX IF NOT EXISTS "transactions_employeeId_idx"
  ON public.transactions ("employeeId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_employeeId_fkey') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT "transactions_employeeId_fkey" FOREIGN KEY ("employeeId")
      REFERENCES public.employees (id) ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Demirbaş (sabit kıymet) listesi — yıl sonu amortisman fişinin kaynağı.
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id text NOT NULL,
  "companyId" text NOT NULL,
  name text NOT NULL,
  "accountCode" text NOT NULL DEFAULT '255',
  "acquisitionDate" timestamp(3) NOT NULL,
  cost numeric(15, 2) NOT NULL,
  "usefulLife" integer NOT NULL,
  method text NOT NULL DEFAULT 'NORMAL',
  "priorDepreciation" numeric(15, 2) NOT NULL DEFAULT 0,
  "disposedAt" timestamp(3),
  "invoiceId" text,
  notes text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "createdBy" text,
  CONSTRAINT fixed_assets_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS "fixed_assets_companyId_idx" ON public.fixed_assets ("companyId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_companyId_fkey') THEN
    ALTER TABLE public.fixed_assets
      ADD CONSTRAINT "fixed_assets_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES public.companies (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Yeni tablo → RLS açık, policy YOK (default deny; CLAUDE.md "Yeni tablo → RLS açılacak").
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
