-- BELGE TARAMA GELEN KUTUSU — document_scans
--
-- NEDEN: fiş tarama "kuyruk yok, akış anında, kaydedilmezse kaybolur" kararıyla
-- yaşıyordu (docs/fis-tarama/KAYIT-AKISI.md). Belge tarama bu kapsamda
-- tutulamıyor: 12 sayfalık PDF, 20 belge birden, onaya sonra dönmek. Okunmuş ama
-- onaylanmamış belge KAYBOLMAZ; kullanıcı gelen kutusundan karta döner.
--
-- DOSYA SAKLANMAZ (karar B, 2026-09-21): satır yalnız okumanın SONUCUNU taşır.
-- `fileSha256` dosyanın izidir — aynı dosya ikinci kez yüklenince yakalanır,
-- dosyanın kendisi yoktur.
--
-- İŞLEME İSTEK İÇİNDE (plan §3.4): her yükleme = tek dosya = tek istek; sonuç
-- bu satıra yazılır. Arka plan işçisi yok — abonelik cron'u da aynı gerekçeyle
-- ertelenmişti (2026-08-08); iki ayrı kuyruk altyapısı açılmıyor.

CREATE TABLE IF NOT EXISTS public.document_scans (
  "id"             TEXT PRIMARY KEY,
  "companyId"      TEXT NOT NULL,
  -- UPLOAD (ekrandan). EMAIL Faz 5'te (karar A: şimdilik yalnız yükleme).
  "source"         TEXT NOT NULL DEFAULT 'UPLOAD',
  "fileName"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "pageCount"      INTEGER NOT NULL DEFAULT 1,
  "fileSha256"     TEXT NOT NULL,
  -- PENDING | READING | AWAITING_APPROVAL | SAVED | REJECTED | FAILED
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  -- Geçiş A çıktısı (sinif/normalize.ts → NormalBelge[]), belge başına.
  "classification" JSONB,
  -- Geçiş B çıktısı: belge başına türe özel çıkarım + denetimler + okuma yolu.
  "extraction"     JSONB,
  -- Hata metni (status FAILED). Sessiz hata yok: kullanıcı kutuda neden
  -- okunamadığını görür.
  "error"          TEXT,
  -- Kaydedilen hedef(ler): [{ "index": 0, "type": "INVOICE", "id": "...", "no": "..." }]
  -- Bir dosyada birden çok belge olabildiği için dizi.
  "targets"        JSONB,
  "model"          TEXT,
  "costUsd"        DECIMAL(10, 6),
  "durationMs"     INTEGER,
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_scans_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE
);

-- Gelen kutusu listesi: firma + durum + yeniden eskiye.
CREATE INDEX IF NOT EXISTS "document_scans_companyId_status_createdAt_idx"
  ON public.document_scans ("companyId", "status", "createdAt" DESC);

-- Mükerrer dosya: aynı sha256 aynı firmada.
CREATE INDEX IF NOT EXISTS "document_scans_companyId_fileSha256_idx"
  ON public.document_scans ("companyId", "fileSha256");

-- RLS: açık, policy yok (default deny) — CLAUDE.md "Yeni tablo → RLS açılacak".
ALTER TABLE public.document_scans ENABLE ROW LEVEL SECURITY;
