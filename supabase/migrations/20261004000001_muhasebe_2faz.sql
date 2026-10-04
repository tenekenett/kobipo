-- MUHASEBE MOTORU — 2. faz (2026-10-04). Plan: docs/muhasebe/MOTOR-PLAN.md
--
-- 1. faz migrasyonu (20261002000002) canlıda uygulandı; bu dosya onun ÜSTÜNE gelir.
--
--   accounting_settings       defter sahibi firma başına ayar: başlangıç tarihi, plan
--                             kurulumu, açılış fişi, dönem kilidi
--   journal_vouchers          + "sourceHash" (kaynak parmak izi), "sourceCompanyId"
--                             (şubenin belgesi ana firmanın defterine yazılır), "kind"
--   account_plans             + "employeeId" (335.01.…), "financialAccountId" (100/102/309.01.…)
--   companies.disabledModules + 'accounting' — YENİ MODÜL KAPALI DOĞAR
--   pricing_items             + 'module:accounting' (pasif; fiyatı sistem yöneticisi verir)
--
-- MODÜL KAPATMA TEKRAR ÇALIŞTIRILABİLİR ve deploy'dan ÖNCE ve HEMEN SONRA birer kez
-- uygulanmalıdır: `disabledModules` bir RED listesidir (lib/modules.ts) — listede olmayan
-- anahtar AÇIK sayılır. Eski kod `applyEntitlements` çalıştırırsa listeyi kendi modül
-- kümesinden (accounting'siz) yeniden yazar ve anahtar düşer; deploy sonrası ikinci
-- çalıştırma bu pencerede düşen firmaları yeniden kapatır. Bedelsiz verilmiş
-- (`grantedModules`) firmaya dokunulmaz.
--
-- Prisma şeması ana kaynaktır; bu dosya Supabase DB'yi hizalar (idempotent).

-- ── Muhasebe ayarı ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_settings (
  "companyId"        TEXT PRIMARY KEY,
  "startDate"        TIMESTAMP(3) NOT NULL,
  "planInstalledAt"  TIMESTAMP(3),
  "openingVoucherId" TEXT,
  "lockedUntil"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "updatedBy"        TEXT,

  CONSTRAINT "accounting_settings_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ── Fiş başlığı ──────────────────────────────────────────────────────────────
ALTER TABLE public.journal_vouchers ADD COLUMN IF NOT EXISTS "sourceHash" TEXT;
ALTER TABLE public.journal_vouchers ADD COLUMN IF NOT EXISTS "sourceCompanyId" TEXT;
ALTER TABLE public.journal_vouchers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'MAHSUP';

-- ── Hesap planı: personel ve kasa/banka alt hesabı ───────────────────────────
ALTER TABLE public.account_plans ADD COLUMN IF NOT EXISTS "employeeId" TEXT;
ALTER TABLE public.account_plans ADD COLUMN IF NOT EXISTS "financialAccountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "account_plans_employeeId_key" ON public.account_plans ("employeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "account_plans_financialAccountId_key" ON public.account_plans ("financialAccountId");

DO $$ BEGIN
  ALTER TABLE public.account_plans
    ADD CONSTRAINT "account_plans_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES public.employees(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.account_plans
    ADD CONSTRAINT "account_plans_financialAccountId_fkey"
    FOREIGN KEY ("financialAccountId") REFERENCES public.financial_accounts(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Yeni modül kapalı doğar (tekrar çalıştırılabilir — başlığa bakın) ────────
UPDATE public.companies
   SET "disabledModules" = array_append("disabledModules", 'accounting')
 WHERE NOT ('accounting' = ANY("disabledModules"))
   AND NOT ('accounting' = ANY("grantedModules"));

-- ── Fiyat kalemi: PASİF doğar ────────────────────────────────────────────────
-- Fiyatı 0 iken satış ekranında görünmesin; sistem yöneticisi fiyatı girip açar.
-- `ensureDefaultPricingItems` deploy sonrası önce davranıp AKTİF bir satır açtıysa
-- ve fiyat hâlâ 0 ise pasife çekilir.
INSERT INTO public.pricing_items (key, label, "monthlyPrice", "yearlyPrice", "isActive", "isFree", "sortOrder", "updatedAt")
VALUES ('module:accounting', 'Muhasebe', 0, 0, false, false, 7, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO UPDATE
   SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
 WHERE public.pricing_items."monthlyPrice" = 0
   AND public.pricing_items."yearlyPrice" = 0
   AND public.pricing_items."isActive" = true;

-- ── RLS: açık ve policy'siz (default deny) — CLAUDE.md "Yeni tablo → RLS" ────
ALTER TABLE public.accounting_settings ENABLE ROW LEVEL SECURITY;
