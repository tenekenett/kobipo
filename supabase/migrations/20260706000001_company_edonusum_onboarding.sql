-- Bayi (İş Ortağı) self-servis e-Dönüşüm hesap açma durum takibi.
-- Kobipo, Mysoft'un iş ortağı olduğu için müşteri adına firma açıp (addTenant)
-- ürünü aktive ediyor (addTenantActivation). Bu kolonlar onboarding sürecinin
-- durumunu tutar. Detaylı plan: docs/e-donusum-onboarding/PLAN.md

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "eDonusumOnboardingStatus" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "eDonusumTenantCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eDonusumActivatedProducts" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "eDonusumActivationError" TEXT;
