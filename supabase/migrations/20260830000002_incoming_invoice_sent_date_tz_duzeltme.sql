-- DÜZELTME: gönderilme tarihi 3 saat İLERİ yazılmıştı.
--
-- 20260830000001 geri doldururken, saat dilimi taşımayan ham değeri ("2026-08-28
-- 14:52:03") olduğu gibi kolona yazıyordu. Kolon `timestamp` (dilimsiz) ve Prisma
-- değerleri UTC kabul ettiği için bu, 14:52 YEREL gönderimi 14:52 UTC yapıyordu:
--   * ekranda saat 3 saat ileri görünüyor (14:52 → 17:52),
--   * gece yarısına yakın gönderim ERTESİ GÜNE taşıyor (23:34 → 02:34),
--   * gönderilme tarihine göre filtre gün sınırında yanlış sonuç veriyor.
--
-- Değerin yerel olduğu ölçüldü: 1.421 kaydın saat dağılımı %81 oranıyla 08:00–19:00
-- arasında toplanıyor, 04:00–07:00 neredeyse boş — Türkiye mesai saatleri. UTC olsaydı
-- dağılım 3 saat kaymış görünürdü. Ayrıca Mysoft aynı kayıtta `docDate`i offset'li
-- ("2026-08-28T00:00:00+03:00"), `createDate`i offset'siz gönderiyor; ikisi de aynı
-- saat konvansiyonunda.
--
-- Yöntem: sabit bir kaydırma DEĞİL, ham JSON'dan YENİDEN hesaplama. Böylece işlem
-- idempotenttir (iki kez çalıştırmak değeri iki kez kaydırmaz) ve zaten doğru
-- yazılmış (offset taşıyan) satırlar bozulmaz. 20260830000001 düzeltilmiş hâliyle
-- uygulanan yeni bir ortamda bu dosya aynı değerleri yeniden üretir.
--
-- Yeni TABLO/kolon yok; RLS adımı gerekmez.

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
