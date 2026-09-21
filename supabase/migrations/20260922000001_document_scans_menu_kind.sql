-- MENÜ TARAMA — document_scans satırı yeniden kullanılır (docs/menu-tarama/PLAN.md §3.11)
--
-- NEDEN YENİ TABLO DEĞİL: satırın taşıdığı her şey aynı (dosya izi, durum,
-- çıkarım, hedefler, model/maliyet/süre) ve gelen kutusu kodu tek yerde kalır.
--
-- `kind` olmadan menü taramaları ALIŞ gelen kutusunda görünürdü: belge tarama
-- listesi artık kind='BELGE' süzer, menü tarama listesi kind='MENU'.
--
-- `sessionId` aynı menünün dosyalarını (4 fotoğraf = 1 menü) bağlar; fark
-- listesi oturum bazında kurulur (karar E). Tek dosyalı menüde de dolu.

ALTER TABLE public.document_scans
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'BELGE';

ALTER TABLE public.document_scans
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

-- Menü gelen kutusu: firma + tür + yeniden eskiye.
CREATE INDEX IF NOT EXISTS "document_scans_companyId_kind_createdAt_idx"
  ON public.document_scans ("companyId", "kind", "createdAt" DESC);

-- Oturumun dosyaları: fark listesi oturumun tüm satırlarını okur.
CREATE INDEX IF NOT EXISTS "document_scans_sessionId_idx"
  ON public.document_scans ("sessionId");

-- RLS zaten açık (20260921000001); kolon eklemek duruşu değiştirmez.
