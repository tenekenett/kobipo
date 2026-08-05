-- Cari (müşteri/tedarikçi) takma adı.
--
-- `name` resmi ünvandır ve faturada/e-belgede o basılır; kullanıcı cariyi günlük
-- hayatta başka bir adla tanır ("Ali Usta"). Bu kolon o adı tutar: cari listesinde
-- ünvanın altında gösterilir ve cari aramasında ünvan/kod/VKN ile birlikte eşleşir.
-- Belge içeriğine GİRMEZ. NULL = takma ad tanımlı değil.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS "nickname" text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS "nickname" text;
