-- Gelen e-faturada GÖNDERİLME TARİHİ artık kolon.
--
-- Neden: liste ve filtreler bugüne kadar yalnız `docDate` (fatura tarihi) ekseninde
-- çalışıyordu. Gönderilme tarihi ham JSON içinde duruyor, istekte tek tek okunup
-- ekrana basılıyordu — yani gösterilebiliyor ama SORGULANAMIYORDU. Geçen ay
-- düzenlenip bu hafta gönderilen fatura "Son 7 gün"de görünmüyordu.
--
-- Alan adı Mysoft sürümleri arasında değiştiği için değer, uygulamadaki aynı aday
-- sırasıyla çıkarılır: envelopeDate → sendDate → createDate → createdDate →
-- lastTrackingDate → documentCreateDate → createDateUtc
-- (lib/integrations/e-invoice/incoming-sent-date.ts). Sıra iki tarafta AYNI olmalı;
-- ayrışırsa geri doldurulmuş satırlar ile yeni senkronize edilenler birbirinden kayar.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS açılacak"):
-- incoming_invoices tablosunun kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- Tip, kardeş sütun "docDate" ile aynı: Prisma'nın PostgreSQL'de DateTime için
-- ürettiği varsayılan (zaman dilimsiz timestamp(3), değerler UTC kabul edilir).
ALTER TABLE public.incoming_invoices
  ADD COLUMN IF NOT EXISTS "sentDate" timestamp(3);

-- Mevcut kayıtları ham JSON'dan geri doldur. Kolon `timestamp` (zaman dilimsiz) ve
-- Prisma değerleri UTC kabul eder; bu yüzden:
--   * saat dilimi TAŞIYAN metin ("...Z", "...+03:00") önce timestamptz'ye çevrilip
--     UTC'ye indirgenir,
--   * dilimsiz metin ("2026-08-28 14:52:03") TÜRKİYE YERELİ kabul edilip UTC'ye
--     çevrilir. Mysoft aynı kayıtta docDate'i offset'li, createDate'i offset'siz
--     gönderiyor; offset'sizi UTC saymak değeri 3 saat İLERİ kaydırırdı (14:52'de
--     gönderilen fatura 17:52 görünür, 23:34 ertesi güne taşardı). Sabit +03:00:
--     Türkiye 2016'dan beri kalıcı UTC+3, yaz saati yok. Uygulama tarafı da aynı
--     offset'i uygular (lib/integrations/e-invoice/incoming-sent-date.ts).
-- Biçimi tanınmayan değer NULL bırakılır: yanlış bir tarih uydurmaktansa "yok"
-- demek doğru — ekran bu satırları "gönderilme tarihi yok" olarak sayar.
WITH kaynak AS (
  SELECT
    id,
    NULLIF(TRIM(COALESCE(
      raw ->> 'envelopeDate',
      raw ->> 'sendDate',
      raw ->> 'createDate',
      raw ->> 'createdDate',
      raw ->> 'lastTrackingDate',
      raw ->> 'documentCreateDate',
      raw ->> 'createDateUtc'
    )), '') AS ham
  FROM public.incoming_invoices
  WHERE "sentDate" IS NULL
)
UPDATE public.incoming_invoices AS ii
SET "sentDate" = CASE
  WHEN kaynak.ham ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
    THEN (kaynak.ham::timestamptz AT TIME ZONE 'UTC')
  ELSE ((kaynak.ham::timestamp AT TIME ZONE INTERVAL '+03:00') AT TIME ZONE 'UTC')
END
FROM kaynak
WHERE ii.id = kaynak.id
  AND kaynak.ham ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$';

-- Tarih aralığı bu eksende de sorgulanacak (docDate'in yanına ikinci indeks).
CREATE INDEX IF NOT EXISTS "incoming_invoices_companyId_sentDate_idx"
  ON public.incoming_invoices ("companyId", "sentDate");
