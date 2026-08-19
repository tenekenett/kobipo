-- Belge şablonlarında BAYATLIK takibi.
--
-- Tasarımcıyla üretilen XSLT'ler repodaki taban şablonun (sample-templates/*.xslt)
-- üzerine tema uygulanarak oluşur. Taban değişince Mysoft'taki kayıtlı tasarım eski
-- kalır ve belgeler eski görselle basılır. Bu iki alan hangi tasarımın hangi taban
-- sürümünden üretildiğini ve en son ne zaman yenilendiğini tutar:
--
--   baseVersion = taban XSLT içeriğinin özeti (sha256 ilk 12 hane)
--   refreshedAt = son yeniden üretim/yükleme zamanı
--
-- NULL = bilinmiyor → arayüz "bayat" gösterir (mevcut kayıtların hepsi böyle başlar).
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (einvoice_templates'te
-- RLS zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.einvoice_templates
  ADD COLUMN IF NOT EXISTS "baseVersion" text,
  ADD COLUMN IF NOT EXISTS "refreshedAt" timestamp(3);
