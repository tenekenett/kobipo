-- Kayıt formunda sorulan şube ismi. Kayıt anında Company kaydı henüz yoktur; değer
-- kullanıcıda saklanır ve ilk firma oluşturulurken formu ön doldurup
-- companies."branchName" alanına taşınır (bkz. 20260805000001_company_branch_name.sql).
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS "companyBranchName" text;
