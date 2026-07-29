-- Restoran & Kafe Aşama 2 / Faz B+: salon planına dükkan krokisi öğeleri.
--
-- Duvar, kapı, bar, mutfak, WC, merdiven, bitki ve serbest yazı. Masalarla aynı
-- ızgara koordinatını kullanırlar ama AYRI tablodadırlar: masanın kimliği
-- (adisyon, ciro, kapasite) var, duvarın yok — aynı tabloda yaşasalardı her
-- "masaları getir" sorgusu duvarları elemek zorunda kalırdı.
--
-- areaId CASCADE: bölge silinince o bölgenin krokisi de gider (masa SetNull ile
-- korunur çünkü geçmiş adisyonları vardır; duvarın geçmişi yoktur).
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

CREATE TABLE IF NOT EXISTS public.restaurant_plan_items (
  id          text PRIMARY KEY,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "areaId"    text REFERENCES public.restaurant_areas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind        text NOT NULL, -- WALL | DOOR | BAR | KITCHEN | WC | STAIRS | PLANT | TEXT
  label       text,
  x           integer NOT NULL DEFAULT 0,
  y           integer NOT NULL DEFAULT 0,
  width       integer NOT NULL DEFAULT 2,
  height      integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "restaurant_plan_items_companyId_idx"
  ON public.restaurant_plan_items ("companyId");

CREATE INDEX IF NOT EXISTS "restaurant_plan_items_areaId_idx"
  ON public.restaurant_plan_items ("areaId");
