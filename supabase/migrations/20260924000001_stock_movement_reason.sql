-- Elle girilen stok ÇIKIŞININ nedeni: SALE | WASTE | SAMPLE | INTERNAL_USE | OTHER
-- (kural: lib/stock/movement-reason.ts).
--
-- Stok raporunun satış adedi belgeye bağlı çıkışlardan kurulur; faturasız satış
-- elle çıkış olarak giriliyordu ve kayıttan fireden ayrılamıyordu. Boş (NULL) =
-- eski kayıt / nedeni sorulmamış hareket → raporda "diğer", satış sayılmaz.
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (stock_movements'ta
-- RLS zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS "reason" text;
