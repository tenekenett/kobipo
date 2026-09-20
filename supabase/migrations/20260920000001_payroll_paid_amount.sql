-- Bordroda FİİLEN ödenen tutar.
--
-- Maaş ödemesi penceresi tutarı bordronun netine kilitliyordu; elden eksik/fazla
-- ödeme ya da avans mahsubu girilemiyordu. Net DEĞİŞMEZ (pusula ve maliyet
-- raporu onu okur); ödenen tutar ayrı saklanır, kasa hareketi bu tutarla yazılır.
-- NULL = bu kolondan önce ödenmiş kayıt, net kadar ödendi sayılır
-- (lib/personel/bordro-odenen.ts).
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (payroll_records'ta
-- RLS zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS "paidAmount" numeric(12, 2);
