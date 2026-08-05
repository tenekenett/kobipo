-- Firma/şube için arayüzde gösterilen kısa ayırt edici ad ("şube ismi").
-- `name` resmi ÜNVAN'dır ve aynı tüzel kişinin tüm şubelerinde aynıdır; bu yüzden
-- firma seçicide şubeler birbirinden ayırt edilemiyordu. Bu kolon yalnızca arayüz
-- içindir (ünvanın yanında parantez içinde gösterilir) — e-belge/fatura içeriğine
-- girmez. NULL = tanımlı değil, yalnızca ünvan gösterilir.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "branchName" text;
