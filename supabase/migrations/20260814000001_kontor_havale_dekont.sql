-- Kontör havale akışı: referans kodu + dekont yükleme.
--
-- Akış: müşteri paketi seçer → sipariş açılırken bir KOD üretilir (KBP-XXXXXX) →
-- müşteri bu kodu havale/EFT AÇIKLAMASINA yazıp parayı gönderir → dekontu Kobipo'ya
-- yükler (sipariş PAYMENT_REVIEW olur) → sistem-admin panelde dekontu ve beyanı görüp
-- "Onayla & Yükle" der. Kod olmadan dekont ile hesap hareketini eşleştirmek elle iş
-- gerektiriyordu; sipariş id'si (cuid) banka açıklamasına yazılamayacak kadar uzun.
--
-- `paymentCode` UNIQUE ama NULLABLE: Postgres'te unique index birden çok NULL'a izin
-- verir, dolayısıyla kart siparişleri ve bu migrasyondan ÖNCEKİ kayıtlar kodsuz kalır.
-- Aşağıda yalnız hâlâ ödeme bekleyen havale siparişlerine kod üretilir; kapanmış
-- (LOADED/REJECTED/FAILED) siparişlerin koda ihtiyacı yok.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.kontor_orders
  ADD COLUMN IF NOT EXISTS "paymentCode"       text,
  ADD COLUMN IF NOT EXISTS "paymentNote"       text,
  ADD COLUMN IF NOT EXISTS "receiptFileName"   text,
  ADD COLUMN IF NOT EXISTS "receiptMimeType"   text,
  ADD COLUMN IF NOT EXISTS "receiptFileSize"   integer,
  ADD COLUMN IF NOT EXISTS "receiptUploadedAt" timestamp(3);

CREATE UNIQUE INDEX IF NOT EXISTS "kontor_orders_paymentCode_key"
  ON public.kontor_orders ("paymentCode");

-- Açık havale siparişlerine kod üret. Karışan karakterler (0/O, 1/I) elenir:
-- kodu telefonda okuyup bankaya yazan insan var. Çakışırsa döngü tekrar dener.
DO $$
DECLARE
  r        record;
  new_code text;
BEGIN
  FOR r IN
    SELECT id FROM public.kontor_orders
    WHERE "paymentCode" IS NULL
      AND "paymentMethod" = 'HAVALE'
      AND status IN ('PENDING_PAYMENT', 'PAYMENT_REVIEW')
  LOOP
    LOOP
      -- md5 çekirdek fonksiyondur (pgcrypto gerekmez); hex çıktısındaki 0/1 harflere
      -- çevrilir, sonuç {A-F, 2-9} kümesinden 6 karakter olur.
      new_code := 'KBP-' || translate(
        upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)), '01', 'GH'
      );
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.kontor_orders WHERE "paymentCode" = new_code);
    END LOOP;
    UPDATE public.kontor_orders SET "paymentCode" = new_code WHERE id = r.id;
  END LOOP;
END $$;

-- Dekont baytları ayrı tabloda: sipariş listeleri her satırda blob taşımasın.
CREATE TABLE IF NOT EXISTS public.kontor_order_receipts (
  id          text PRIMARY KEY,
  "orderId"   text NOT NULL UNIQUE,
  data        bytea NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  CONSTRAINT "kontor_order_receipts_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES public.kontor_orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Yeni tablo → RLS açık ve policy'siz (default deny). CLAUDE.md "Yeni tablo → RLS
-- açılacak": veriye tek erişim yolu uygulamanın postgres bağlantısıdır.
ALTER TABLE public.kontor_order_receipts ENABLE ROW LEVEL SECURITY;
