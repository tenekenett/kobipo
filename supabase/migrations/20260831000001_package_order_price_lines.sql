-- Paket siparişinin KALEM DÖKÜMÜNÜ kalıcı hâle getirir.
--
-- Neden: tutarın kalem kalem dökümü (`computeOrder` → OrderLine[]) satın alma anında
-- hesaplanıyor, istemciye ödeme ekranında gösteriliyor ve sonra ATILIYORDU. Veritabanına
-- yalnız toplam (`amount`) düşüyordu. Sonuç: "müşteri hangi modüle ne kadar ödedi"
-- sorusunun cevabı hiçbir yerde yok.
--
-- Sonradan yeniden hesaplamak cevap DEĞİLDİR: `PricingItem` ve `Plan` fiyatları canlıda
-- değişiyor, yeniden hesap BUGÜNÜN fiyatını verir — müşterinin ödediğini değil. Bu yüzden
-- döküm, tutarın kendisi gibi, sipariş anında snapshot'lanır.
--
-- Geçmiş siparişlerde NULL kalır (o an kaydedilmemiş bir veri geriye üretilemez); arayüz
-- bunu "döküm yok" diye açıkça söyler, uydurmaz.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).
ALTER TABLE public.package_orders
  ADD COLUMN IF NOT EXISTS "priceLines" JSONB;
