-- CARİ VİRMAN FİŞİ — kasaya dokunmadan cari bakiyesi aktarır (lib/cari/virman.ts).
--
-- NEDEN YENİ TABLO: mevcut kayıtların hiçbiri taşıyamıyor. Transaction kasa
-- hesabı ister (accountId NOT NULL), InvoicePayment fatura ister, bakiye kapama
-- yalnız açık faturayı kapatır. Virman ise iki carinin arasında (ya da tek
-- carinin kendisinde) faturasız, kasasız bir borç/alacak kaydıdır.
--
-- Bir fiş EN FAZLA iki bacaktır: bir cari "Virman Borç" (DEBIT), öbürü "Virman
-- Alacak" (CREDIT). Karşı cari isteğe bağlıdır; tek bacaklı fiş karşılıksız
-- dekonttur. Tutar ve tarih yalnız başlıkta durur.
--
-- Cari bakiyesini kuran HER yer bu tabloyu okur (liste, kart, ekstre,
-- yaşlandırma, arşiv kapısı); eşitlikleri lib/cari/bakiye-tutarlilik.canli.test.ts
-- ile ölçülür.

CREATE TABLE IF NOT EXISTS public.cari_virman (
  "id"          TEXT PRIMARY KEY,
  "companyId"   TEXT NOT NULL,
  "virmanNo"    TEXT NOT NULL,
  "date"        TIMESTAMP(3) NOT NULL,
  "amount"      DECIMAL(15, 2) NOT NULL,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"   TEXT,

  CONSTRAINT "cari_virman_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT "cari_virman_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "cari_virman_companyId_virmanNo_key"
  ON public.cari_virman ("companyId", "virmanNo");

CREATE INDEX IF NOT EXISTS "cari_virman_companyId_date_idx"
  ON public.cari_virman ("companyId", "date");

CREATE TABLE IF NOT EXISTS public.cari_virman_legs (
  "id"         TEXT PRIMARY KEY,
  "virmanId"   TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  -- DEBIT ("Virman Borç") | CREDIT ("Virman Alacak")
  "side"       TEXT NOT NULL,
  "customerId" TEXT,
  "supplierId" TEXT,

  CONSTRAINT "cari_virman_legs_virmanId_fkey"
    FOREIGN KEY ("virmanId") REFERENCES public.cari_virman(id) ON DELETE CASCADE,
  CONSTRAINT "cari_virman_legs_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NO ACTION (RESTRICT değil): bacağı olan cari tek başına silinemez, ama firma
  -- silinirken aynı ifadede bacak da düştüğü için zincirleme silme takılmaz.
  CONSTRAINT "cari_virman_legs_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE NO ACTION,
  CONSTRAINT "cari_virman_legs_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES public.suppliers(id) ON DELETE NO ACTION,
  CONSTRAINT "cari_virman_legs_side_check" CHECK ("side" IN ('DEBIT', 'CREDIT')),
  -- Bacak TEK cariye aittir: müşteri YA DA tedarikçi.
  CONSTRAINT "cari_virman_legs_one_party" CHECK (("customerId" IS NULL) <> ("supplierId" IS NULL))
);

-- Fişte her yönden en fazla bir bacak.
CREATE UNIQUE INDEX IF NOT EXISTS "cari_virman_legs_virmanId_side_key"
  ON public.cari_virman_legs ("virmanId", "side");

CREATE INDEX IF NOT EXISTS "cari_virman_legs_customerId_idx"
  ON public.cari_virman_legs ("customerId");

CREATE INDEX IF NOT EXISTS "cari_virman_legs_supplierId_idx"
  ON public.cari_virman_legs ("supplierId");

CREATE INDEX IF NOT EXISTS "cari_virman_legs_companyId_idx"
  ON public.cari_virman_legs ("companyId");

ALTER TABLE public.cari_virman ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cari_virman_legs ENABLE ROW LEVEL SECURITY;
