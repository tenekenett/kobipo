-- MUHASEBE MOTORU — 1. faz veri modeli (2026-10-02). Plan: docs/muhasebe/MOTOR-PLAN.md
--
-- Belgeden kendiliğinden doğan TASLAK yevmiye fişi → kullanıcı eksik hesabı seçer →
-- ONAY. Eski `accounting_entries` satır başına tek borç–tek alacak tutuyordu (çok
-- satırlı mahsup fişi, taslak/onay ve öğrenme yoktu); canlıda tek firmada 3 kaydı var,
-- bu migrasyon ona DOKUNMAZ.
--
--   journal_vouchers       fiş başlığı; belge başına tek fiş (companyId, sourceType, sourceId)
--   journal_voucher_lines  fiş satırları; "accountId" boşsa hesap seçilmemiştir
--   account_mapping_rules  öğrenilen eşleşme: anahtar ("alis:cari-kdv:<id>:20") → hesap
--   account_plans          + "customerId"/"supplierId": cari alt hesabı (120.… / 320.…)
--
-- Kural motoru saf ve testli: lib/muhasebe/fis-kurallari.ts. Bu tabloları okuyan/
-- yazan kod henüz YOK (2. faz); migrasyon önden uygulanabilir.
-- Prisma şeması ana kaynaktır; bu dosya Supabase DB'yi hizalar (idempotent).

-- ── Hesap planı: cari alt hesabı ─────────────────────────────────────────────
ALTER TABLE public.account_plans ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE public.account_plans ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "account_plans_customerId_key" ON public.account_plans ("customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "account_plans_supplierId_key" ON public.account_plans ("supplierId");

DO $$ BEGIN
  ALTER TABLE public.account_plans
    ADD CONSTRAINT "account_plans_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.account_plans
    ADD CONSTRAINT "account_plans_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES public.suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Yevmiye fişi ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_vouchers (
  id                TEXT PRIMARY KEY,
  "companyId"       TEXT NOT NULL,
  "voucherNo"       TEXT NOT NULL,
  date              TIMESTAMP(3) NOT NULL,
  description       TEXT,
  -- DRAFT (taslak) | POSTED (onaylı)
  status            TEXT NOT NULL DEFAULT 'DRAFT',
  -- INVOICE | PAYMENT | TRANSACTION | MANUAL
  "sourceType"      TEXT NOT NULL,
  "sourceId"        TEXT,
  "isConfident"     BOOLEAN NOT NULL DEFAULT false,
  "sourceChangedAt" TIMESTAMP(3),
  "approvedAt"      TIMESTAMP(3),
  "approvedBy"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdBy"       TEXT,

  CONSTRAINT "journal_vouchers_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_vouchers_companyId_voucherNo_key"
  ON public.journal_vouchers ("companyId", "voucherNo");
-- Belge başına tek fiş. sourceId NULL (elle fiş) satırlar Postgres'te çakışmaz.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_vouchers_companyId_sourceType_sourceId_key"
  ON public.journal_vouchers ("companyId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "journal_vouchers_companyId_status_date_idx"
  ON public.journal_vouchers ("companyId", status, date);

-- ── Fiş satırları ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_voucher_lines (
  id              TEXT PRIMARY KEY,
  "voucherId"     TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "order"         INTEGER NOT NULL,
  -- DEBIT | CREDIT
  side            TEXT NOT NULL,
  amount          DECIMAL(15, 2) NOT NULL,
  "accountId"     TEXT,
  "suggestedCode" TEXT NOT NULL,
  role            TEXT NOT NULL,
  -- LEARNED | CARI | DEFAULT | NONE
  "accountSource" TEXT NOT NULL,
  "learnKeys"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  description     TEXT,

  CONSTRAINT "journal_voucher_lines_voucherId_fkey"
    FOREIGN KEY ("voucherId") REFERENCES public.journal_vouchers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journal_voucher_lines_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Fişte kullanılan hesap silinemez.
  CONSTRAINT "journal_voucher_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES public.account_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "journal_voucher_lines_voucherId_idx"
  ON public.journal_voucher_lines ("voucherId");
CREATE INDEX IF NOT EXISTS "journal_voucher_lines_companyId_accountId_idx"
  ON public.journal_voucher_lines ("companyId", "accountId");

-- ── Öğrenilen hesap eşleşmeleri ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_mapping_rules (
  id          TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  key         TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "account_mapping_rules_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "account_mapping_rules_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES public.account_plans(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_mapping_rules_companyId_key_key"
  ON public.account_mapping_rules ("companyId", key);

-- ── RLS: açık ve policy'siz (default deny) — CLAUDE.md "Yeni tablo → RLS" ────
ALTER TABLE public.journal_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_mapping_rules ENABLE ROW LEVEL SECURITY;
