-- Paket / Abonelik sistemi.
-- Hibrit fiyatlandırma (hazır paket + à la carte tekil modül/şube), hesap düzeyi
-- abonelik + şube kotası, PayTR ile (opsiyonel recurring) ödeme.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- 1) Paket sipariş durumu enum'ı
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackageOrderStatus') THEN
    CREATE TYPE "PackageOrderStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'FAILED', 'CANCELLED');
  END IF;
END $$;

-- 2) plans: bundle (hazır paket) alanları
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS "includedModules" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "includedBranches" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS highlighted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0;

-- 3) pricing_items: à la carte tekil fiyatlar (module:<key>, branch)
CREATE TABLE IF NOT EXISTS public.pricing_items (
  key text PRIMARY KEY,
  label text NOT NULL,
  "monthlyPrice" numeric(10,2) NOT NULL DEFAULT 0,
  "yearlyPrice" numeric(10,2) NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 4) subscriptions: abonelik alanları + planId nullable + FK SET NULL
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS "billingCycle" text,
  ADD COLUMN IF NOT EXISTS "purchasedModules" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "branchQuota" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS "autoRenew" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "paymentRef" text;

-- planId artık opsiyonel (tam custom alımda bundle yok)
ALTER TABLE public.subscriptions ALTER COLUMN "planId" DROP NOT NULL;

-- FK'yı ON DELETE RESTRICT -> SET NULL olarak yenile (plan silinince abonelik korunur)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subscriptions_planId_fkey'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT "subscriptions_planId_fkey";
  END IF;
  ALTER TABLE public.subscriptions
    ADD CONSTRAINT "subscriptions_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES public.plans(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

-- 5) package_orders: PayTR ödeme siparişi (id = merchant_oid)
CREATE TABLE IF NOT EXISTS public.package_orders (
  id text PRIMARY KEY,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  "planId" text REFERENCES public.plans(id) ON DELETE SET NULL,
  "planName" text,
  "selectedModules" TEXT[] NOT NULL DEFAULT '{}',
  "resolvedModules" TEXT[] NOT NULL DEFAULT '{}',
  "branchQuota" integer NOT NULL DEFAULT 0,
  "billingCycle" text NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'TRY',
  "autoRenew" boolean NOT NULL DEFAULT true,
  status "PackageOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "paymentProvider" text,
  "paidAt" timestamptz,
  "paymentRef" text,
  "paymentError" text,
  "recurringToken" text,
  "createdById" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_orders_companyId_status_idx
  ON public.package_orders("companyId", status);
CREATE INDEX IF NOT EXISTS package_orders_status_idx
  ON public.package_orders(status);
