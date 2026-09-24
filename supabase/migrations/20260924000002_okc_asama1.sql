-- ÖKC (YAZARKASA) — AŞAMA 1: cihaz tanımı, Z raporu kaydı, fişin mali kimliği,
-- adisyon bölme izi. Plan: docs/okc/ASAMA1-KOBIPO.md
--
-- Cihaza bağlanma (bulut sepet API'si, webhook) Aşama 2'dir; bu migrasyon
-- cihaz yokken de çalışan kayıt yapısını kurar: Z raporu gün sonunda ELLE
-- girilir, Kobipo kendi fişleriyle karşılaştırır (lib/okc/z-mutabakat.ts).

-- 1) Yazarkasa tanımı — ŞUBE bazlıdır (her şubenin kendi cihazı var).
CREATE TABLE IF NOT EXISTS public.okc_devices (
  "id"        TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "brand"     TEXT,
  "model"     TEXT,
  -- Cihazın mali sicil / seri numarası (Z fişinde ve cihaz arkasında yazar).
  "serialNo"  TEXT NOT NULL,
  -- GÜNCEL EKÜ numarası. EKÜ dolunca değişir; geçmişi her Z kaydı kendi
  -- üzerinde taşır (okc_z_reports.ekuNo), buradaki değer yalnız bugündür.
  "ekuNo"     TEXT,
  -- Cihaza nasıl bağlanılıyor. Aşama 1'de hep MANUAL (bağlantı yok).
  "provider"  TEXT NOT NULL DEFAULT 'MANUAL',
  -- Aşama 2: INSTANT (kasa — sepet gelince ödeme ekranı açılır) | LIST (masa —
  -- sepet cihazda listede bekler). Bağlantı yokken anlamsız, NULL kalır.
  "mode"      TEXT,
  -- Z kaydı olan cihaz SİLİNMEZ (FK NO ACTION), pasife alınır.
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,

  CONSTRAINT "okc_devices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT "okc_devices_provider_check"
    CHECK ("provider" IN ('MANUAL', 'TOKEN', 'PAVO', 'ODEAL')),
  CONSTRAINT "okc_devices_mode_check"
    CHECK ("mode" IS NULL OR "mode" IN ('INSTANT', 'LIST'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "okc_devices_companyId_serialNo_key"
  ON public.okc_devices ("companyId", "serialNo");

-- 2) Z raporu kaydı. Aşama 1'de gün sonunda Z fişinden ELLE girilir.
CREATE TABLE IF NOT EXISTS public.okc_z_reports (
  "id"           TEXT PRIMARY KEY,
  "companyId"    TEXT NOT NULL,
  "deviceId"     TEXT NOT NULL,
  "zNo"          INTEGER NOT NULL,
  -- Z'nin ALINDIĞI an. Gün sınırı budur, takvim günü değil: gece 02:00'de
  -- kapanan kafenin günü önceki Z'den bu Z'ye kadardır.
  "takenAt"      TIMESTAMP(3) NOT NULL,
  -- O anki EKÜ (cihazdaki güncel değerin anlık kopyası).
  "ekuNo"        TEXT,
  "receiptCount" INTEGER,
  -- KDV dahil günlük satış toplamı.
  "grossTotal"   DECIMAL(15, 2) NOT NULL,
  -- [{ "rate": 10, "base": 909.09, "vat": 90.91 }] — Z fişindeki KDV kırılımı.
  "vatLines"     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "method": "CASH" | "CREDIT_CARD" | "MEAL_CARD" | "OTHER", "amount": 500 }]
  "paymentLines" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cancelCount"  INTEGER,
  "cancelTotal"  DECIMAL(15, 2),
  -- MANUAL (elle) | DEVICE (Aşama 2) | SCAN (Z fişinin fotoğrafından, sonra)
  "source"       TEXT NOT NULL DEFAULT 'MANUAL',
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"    TEXT,
  "updatedBy"    TEXT,

  CONSTRAINT "okc_z_reports_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NO ACTION (RESTRICT değil): Z kaydı olan cihaz tek başına silinemez, ama
  -- firma silinirken aynı ifadede Z kaydı da düştüğü için zincirleme takılmaz.
  CONSTRAINT "okc_z_reports_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES public.okc_devices(id) ON DELETE NO ACTION,
  CONSTRAINT "okc_z_reports_zNo_positive" CHECK ("zNo" > 0),
  CONSTRAINT "okc_z_reports_grossTotal_nonneg" CHECK ("grossTotal" >= 0),
  CONSTRAINT "okc_z_reports_source_check" CHECK ("source" IN ('MANUAL', 'DEVICE', 'SCAN'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "okc_z_reports_deviceId_zNo_key"
  ON public.okc_z_reports ("deviceId", "zNo");

CREATE INDEX IF NOT EXISTS "okc_z_reports_companyId_takenAt_idx"
  ON public.okc_z_reports ("companyId", "takenAt");

-- 3) Fişin mali kimliği FİŞİN ÜSTÜNDE durur. Aşama 2'deki sepet kaydı yalnız
--    taşımadır; rapor ve mutabakat buradan okur.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "okcDeviceId"  TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "okcReceiptNo" INTEGER;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "okcZNo"       INTEGER;
-- Numaralar Kobipo'ya nasıl girdi: DEVICE (cihazdan) | USER (kullanıcı yazdı).
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "okcSource"    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_okcDeviceId_fkey') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT "invoices_okcDeviceId_fkey"
      FOREIGN KEY ("okcDeviceId") REFERENCES public.okc_devices(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_okcSource_check') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT "invoices_okcSource_check"
      CHECK ("okcSource" IS NULL OR "okcSource" IN ('DEVICE', 'USER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoices_companyId_okcDeviceId_okcZNo_idx"
  ON public.invoices ("companyId", "okcDeviceId", "okcZNo");

-- 4) Adisyon bölme izi: "ADS-0012'den bölündü". Birleştirmedeki mergedIntoId
--    deseninin tersi. Kaynak silinirse iz kopar, parça kalır.
ALTER TABLE public.restaurant_tickets ADD COLUMN IF NOT EXISTS "splitFromId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tickets_splitFromId_fkey') THEN
    ALTER TABLE public.restaurant_tickets
      ADD CONSTRAINT "restaurant_tickets_splitFromId_fkey"
      FOREIGN KEY ("splitFromId") REFERENCES public.restaurant_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "restaurant_tickets_splitFromId_idx"
  ON public.restaurant_tickets ("splitFromId");

ALTER TABLE public.okc_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okc_z_reports ENABLE ROW LEVEL SECURITY;
