-- Salon planı 2. tur: kare kroki, masa durumları, rezervasyon ve adisyon birleştirme.
--
-- Kullanıcı isteği (2026-08-01): "kroki kısmı birden fazla ve eklenebilir olmalı
-- ayrıca kare olmalı… tümü kısmında ön bahçenin arka bahçenin planını görebilmeliyiz",
-- ardından masa durumları ve masa taşıma/birleştirme.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- 1) Bölge = bir KROKİ. Tuval kare olduğu için tek kenar uzunluğu yeter (hücre).
ALTER TABLE public.restaurant_areas
  ADD COLUMN IF NOT EXISTS "gridSize" integer NOT NULL DEFAULT 16;

-- 2) Masa "toplanacak" damgası. Masayı kilitlemez, yalnız planda gösterilir;
--    yeni adisyon açılınca temizlenir.
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS "cleaningSince" timestamptz;

-- 3) "Hesap istendi" — adisyon açık kalır, masa planda ayrı renge döner.
ALTER TABLE public.restaurant_tickets
  ADD COLUMN IF NOT EXISTS "billRequestedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "billRequestedBy" text;

-- 4) Birleştirme izi. Kaynak adisyon CANCELLED olur ama iptal DEĞİLDİR:
--    cirosu hedefe geçti. Rapor/ekran bu alana bakıp ayırt eder.
ALTER TABLE public.restaurant_tickets
  ADD COLUMN IF NOT EXISTS "mergedIntoId" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_tickets_mergedIntoId_fkey'
  ) THEN
    ALTER TABLE public.restaurant_tickets
      ADD CONSTRAINT "restaurant_tickets_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId") REFERENCES public.restaurant_tickets(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "restaurant_tickets_mergedIntoId_idx"
  ON public.restaurant_tickets ("mergedIntoId");

-- 5) Rezervasyon — masanın GELECEKTEKİ dolusu. Adisyondan ayrı tablo: adisyon
--    "şu an oturan"ı anlatır, rezervasyon henüz gerçekleşmemiştir ve hiçbir ciro
--    sorgusuna girmemelidir.
CREATE TABLE IF NOT EXISTS public.restaurant_reservations (
  id            text PRIMARY KEY,
  "companyId"   text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- SetNull: masa silinse de rezervasyon kaybolmasın (masasız listede kalır).
  "tableId"     text REFERENCES public.restaurant_tables(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "guestName"   text NOT NULL,
  phone         text,
  "guestCount"  integer,
  "reservedAt"  timestamptz NOT NULL,
  "durationMin" integer NOT NULL DEFAULT 90,
  note          text,
  status        varchar(10) NOT NULL DEFAULT 'PENDING', -- PENDING | SEATED | NOSHOW | CANCELLED
  -- Misafir oturunca açılan adisyon: rezervasyonun gerçekleştiğinin tek kanıtı.
  "ticketId"    text REFERENCES public.restaurant_tickets(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "createdBy"   text,
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_reservations_ticketId_key"
  ON public.restaurant_reservations ("ticketId");

CREATE INDEX IF NOT EXISTS "restaurant_reservations_companyId_reservedAt_idx"
  ON public.restaurant_reservations ("companyId", "reservedAt");

CREATE INDEX IF NOT EXISTS "restaurant_reservations_tableId_reservedAt_idx"
  ON public.restaurant_reservations ("tableId", "reservedAt");
