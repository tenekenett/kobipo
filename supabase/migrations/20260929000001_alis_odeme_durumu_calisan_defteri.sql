-- ALIŞ FATURASI: ödeme durumu + stok takibi seçimi (2026-09-29).
--
-- 1) invoices."skipStock" — "Stok girişi yapılmasın". Alış faturası bugüne kadar
--    her zaman stoğa işleniyordu. Seçim KAYITTA durmak zorunda: düzenleme ucu stoğu
--    kalemlerden yeniden kurar ve bayrağı bilmeseydi ilk düzenlemede stoğu yazardı.
--    Varsayılan false = bugünkü davranış; mevcut faturalar değişmez.
--
-- 2) employee_ledger_entries — ÇALIŞAN MASRAF DEFTERİ. "Çalışan cebinden ödedi"
--    seçilince tedarikçi borcu kapanır ama firma çalışana borçlanır; bu borç hiçbir
--    yerde durmasaydı kasadan çıkmayan para bilançodan da kaybolurdu. Defter TUTAR
--    TUTMAZ: tutar/tarih bağlı para kaydındadır (fatura ödemesi ya da kasa hareketi).
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).
-- DEPLOY'DAN ÖNCE uygulanmalı: Prisma istemcisi invoices."skipStock"u her fatura
-- okumasında seçer, kolon yoksa fatura ekranları düşer.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS "skipStock" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.employee_ledger_entries (
  "id"               TEXT PRIMARY KEY,
  "companyId"        TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  -- EXPENSE (çalışan firma adına ödedi, bakiye +) | REIMBURSEMENT (firma çalışana ödedi, bakiye −)
  "kind"             TEXT NOT NULL,
  "invoicePaymentId" TEXT,
  "transactionId"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"        TEXT,

  CONSTRAINT "employee_ledger_entries_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NO ACTION (RESTRICT değil): satırı olan çalışan tek başına silinemez, ama firma
  -- silinirken aynı ifadede satır da düştüğü için zincirleme silme takılmaz.
  CONSTRAINT "employee_ledger_entries_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES public.employees(id) ON DELETE NO ACTION,
  -- Para kaydı silinince (ödeme silindi, kasa hareketi silindi) satır da düşer.
  CONSTRAINT "employee_ledger_entries_invoicePaymentId_fkey"
    FOREIGN KEY ("invoicePaymentId") REFERENCES public.invoice_payments(id) ON DELETE CASCADE,
  CONSTRAINT "employee_ledger_entries_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON DELETE CASCADE,
  -- Tür ile bağ birbirini belirler: gider satırı fatura ödemesine, iade satırı kasa
  -- hareketine bağlıdır — ikisine birden ya da hiçbirine değil.
  CONSTRAINT "employee_ledger_entries_kind_link" CHECK (
    ("kind" = 'EXPENSE' AND "invoicePaymentId" IS NOT NULL AND "transactionId" IS NULL)
    OR ("kind" = 'REIMBURSEMENT' AND "transactionId" IS NOT NULL AND "invoicePaymentId" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_ledger_entries_invoicePaymentId_key"
  ON public.employee_ledger_entries ("invoicePaymentId");

CREATE UNIQUE INDEX IF NOT EXISTS "employee_ledger_entries_transactionId_key"
  ON public.employee_ledger_entries ("transactionId");

CREATE INDEX IF NOT EXISTS "employee_ledger_entries_companyId_idx"
  ON public.employee_ledger_entries ("companyId");

CREATE INDEX IF NOT EXISTS "employee_ledger_entries_employeeId_idx"
  ON public.employee_ledger_entries ("employeeId");

ALTER TABLE public.employee_ledger_entries ENABLE ROW LEVEL SECURITY;
