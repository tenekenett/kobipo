-- Hesap (faturalama) kökü + ek FİRMA kotası: "şube" ile "firma" kavramlarını ayırır.
--
-- Önce: yeni bağımsız firma açma hakkı Plan."maxCompanies" ile ölçülüyordu ve o değer
-- paketin ŞUBE adedinden türetiliyordu ("maxCompanies" = includedBranches + 1). İki
-- kavram tek sayaca bindiği için şube açmak firma hakkını yiyor, à la carte (paketsiz)
-- alımda ise hak 1'e düşüyordu — kullanıcıya satılabilecek bir "ek firma" ürünü de yoktu.
--
-- Sonra: iki ayrı eksen.
--   şube     → parentCompanyId dolu   (aynı tüzel kişi; VKN/e-Dönüşüm devralınır)
--   ek firma → accountRootId dolu     (AYRI tüzel kişi: kendi VKN'si/adresi; abonelik
--              ve modüller hesap kökünden akar)
-- Kotalar: subscriptions."branchQuota" (şube) ve yeni "companyQuota" (firma).
--
-- accountRootId hesaba ait TÜM firmalarda (şubeler dahil) kökün id'sini taşır; böylece
-- hesap tek sorguda çözülür, zincir yürünmez (lib/billing/entitlements.ts).
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS açılacak");
-- companies/plans/subscriptions/package_orders kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- 1) Hesap kökü bağı ------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "accountRootId" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_accountRootId_fkey'
  ) THEN
    -- SET NULL (şubedeki CASCADE değil): kök silinirse ek firma kendi kökü olur.
    -- Ayrı tüzel kişinin verisi başka bir firmanın silinmesiyle yok olmamalı.
    ALTER TABLE public.companies
      ADD CONSTRAINT "companies_accountRootId_fkey"
      FOREIGN KEY ("accountRootId") REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "companies_accountRootId_idx"
  ON public.companies("accountRootId");

-- Mevcut şubeler zaten hesap üyesidir: kökleri ana firmalarıdır. (Şube zinciri şema
-- düzeyinde yasak olduğu için parentCompanyId doğrudan köktür.)
UPDATE public.companies
   SET "accountRootId" = "parentCompanyId"
 WHERE "parentCompanyId" IS NOT NULL
   AND "accountRootId" IS NULL;

-- 2) Firma kotası ---------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS "companyQuota" integer NOT NULL DEFAULT 0;

ALTER TABLE public.package_orders
  ADD COLUMN IF NOT EXISTS "companyQuota" integer NOT NULL DEFAULT 0;

-- 3) Pakete dahil ek firma; maxCompanies emekli ---------------------------------------
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS "includedCompanies" integer NOT NULL DEFAULT 0;

-- Eski türetme geri alınır: "maxCompanies" = kök + dahil ek şube idi, yani firma hakkı
-- hiç satılmamıştı. Dahil ek firma 0'dan başlar; paketler admin panelinden belirlenir.
ALTER TABLE public.plans
  DROP COLUMN IF EXISTS "maxCompanies";
