-- İLÇE — firma adresinin ayrı tutulan tek parçası.
--
-- Neden ayrı kolon: UBL-TR'de `cac:PostalAddress` içinde İLÇE (cbc:CitySubdivisionName)
-- İl ile birlikte ZORUNLUDUR. Kobipo'da firma adresi tek serbest metin olduğu için ilçe
-- bugüne kadar bilinmiyordu ve iki yerde İL ile dolduruluyordu:
--   1) şubenin e-belgeye yazılan adresi (AgentParty — 20260912000001_company_branch_no.sql),
--   2) Mysoft mükellef kaydı açılışı (self-servis onboarding, createTenant).
-- Sonuç belgede "DENİZLİ / DENİZLİ" gibi görünüyordu: şematron geçiyor ama adres yanlış.
--
-- Boş bırakılabilir; boşken eski davranış (il ile doldurma) sürer.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "district" TEXT;

-- companies zaten RLS altında (20260811000003_rls_lockdown.sql); yeni tablo yok.
