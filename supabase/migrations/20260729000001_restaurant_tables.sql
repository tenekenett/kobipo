-- Restoran & Kafe Aşama 2: masa, salon planı ve adisyon.
--
-- Kararlar: docs/restoran/ASAMA2.md · yön: docs/restoran/PLAN.md "Adım 7".
--
-- Adisyon (RestaurantTicket), saatlerce açık kalan bir ÇALIŞMA kaydıdır; resmî
-- belge değildir. Kapanışta v1'in fiş yoluna bağlanır (`invoices.isReceipt`) ve
-- stok O ANDA düşer — kalem eklerken değil. Gerekçe ASAMA2.md'de.
--
-- Yerleşim (x/y/width/height) masa satırında durur, ayrı bir plan JSON'unda
-- değil: masanın kimliği (adisyonu, cirosu) var, iki yerde yaşarsa ayrışır.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- Bölge/salon: "Bahçe", "Üst Kat". Salon planında sekme olur.
CREATE TABLE IF NOT EXISTS public.restaurant_areas (
  id          text PRIMARY KEY,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name        text NOT NULL,
  "order"     integer NOT NULL DEFAULT 0,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_areas_companyId_name_key"
  ON public.restaurant_areas ("companyId", name);

CREATE INDEX IF NOT EXISTS "restaurant_areas_companyId_idx"
  ON public.restaurant_areas ("companyId");

-- Masa. x/y/width/height ızgara HÜCRESİ cinsindendir (piksel değil) — ekran
-- ölçeği değişince yerleşim bozulmasın.
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id          text PRIMARY KEY,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- SetNull: bölge silinince masa kaybolmasın, bölgesiz kalsın.
  "areaId"    text REFERENCES public.restaurant_areas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  name        text NOT NULL,
  capacity    integer,
  shape       text NOT NULL DEFAULT 'SQUARE', -- SQUARE | CIRCLE | RECT
  x           integer NOT NULL DEFAULT 0,
  y           integer NOT NULL DEFAULT 0,
  width       integer NOT NULL DEFAULT 2,
  height      integer NOT NULL DEFAULT 2,
  -- Masa SİLİNMEZ, pasifleştirilir: geçmiş adisyonlar masasız kalmasın.
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_tables_companyId_name_key"
  ON public.restaurant_tables ("companyId", name);

CREATE INDEX IF NOT EXISTS "restaurant_tables_companyId_idx"
  ON public.restaurant_tables ("companyId");

CREATE INDEX IF NOT EXISTS "restaurant_tables_areaId_idx"
  ON public.restaurant_tables ("areaId");

-- Adisyon. `tableId` opsiyonel: paket/gel-al adisyonu masasız açılır.
CREATE TABLE IF NOT EXISTS public.restaurant_tickets (
  id           text PRIMARY KEY,
  "companyId"  text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "tableId"    text REFERENCES public.restaurant_tables(id) ON DELETE SET NULL ON UPDATE CASCADE,
  code         text NOT NULL, -- ADS-2026-0001
  status       text NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | CANCELLED
  "guestCount" integer,
  note         text,
  "customerId" text REFERENCES public.customers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "openedAt"   timestamptz NOT NULL DEFAULT now(),
  "openedBy"   text,
  "closedAt"   timestamptz,
  "closedBy"   text,
  -- Kapanışta oluşan fiş; fatura silinirse bağ kopar, adisyon geçmişte kalır.
  "invoiceId"  text REFERENCES public.invoices(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_tickets_invoiceId_key"
  ON public.restaurant_tickets ("invoiceId");

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_tickets_companyId_code_key"
  ON public.restaurant_tickets ("companyId", code);

CREATE INDEX IF NOT EXISTS "restaurant_tickets_companyId_status_idx"
  ON public.restaurant_tickets ("companyId", status);

CREATE INDEX IF NOT EXISTS "restaurant_tickets_tableId_idx"
  ON public.restaurant_tickets ("tableId");

-- Adisyon kalemi. unitPrice NET'tir (KDV hariç) — fatura API'si net bekliyor.
-- description ürün adının KOPYASIDIR: ürün yeniden adlandırılsa adisyon değişmez.
CREATE TABLE IF NOT EXISTS public.restaurant_ticket_items (
  id          text PRIMARY KEY,
  "ticketId"  text NOT NULL REFERENCES public.restaurant_tickets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- SetNull: ürün kartı silinse de kalem (adı ve fiyatı kopyalı) durur.
  "productId" text REFERENCES public.products(id) ON DELETE SET NULL ON UPDATE CASCADE,
  description text NOT NULL,
  unit        text NOT NULL DEFAULT 'ADET',
  quantity    numeric(14, 4) NOT NULL,
  "unitPrice" numeric(15, 6) NOT NULL,
  "vatRate"   numeric(5, 2) NOT NULL DEFAULT 20,
  note        text,
  "order"     integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" text
);

CREATE INDEX IF NOT EXISTS "restaurant_ticket_items_ticketId_idx"
  ON public.restaurant_ticket_items ("ticketId");

CREATE INDEX IF NOT EXISTS "restaurant_ticket_items_productId_idx"
  ON public.restaurant_ticket_items ("productId");
