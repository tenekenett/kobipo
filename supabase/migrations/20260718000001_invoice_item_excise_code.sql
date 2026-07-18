-- ÖTV GİB Vergi Türü Kodu: invoice_items."exciseCode" (VARCHAR(10)).
-- ÖTV oranı (exciseRate) girildiğinde, GİB e-Fatura payload'ında ek vergi olarak
-- hangi liste koduyla gönderileceğini tutar (0071 I. Liste / 0073 III. Liste /
-- 0074 IV. Liste ...). Boş/NULL ise gönderimde son çare 0074 (IV. Liste) kullanılır.
-- Bu kod olmadan ÖTV GİB'e HİÇ gitmiyordu (payload'a eklenmiyordu).
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS "exciseCode" varchar(10);

-- "Diğer Vergi" GİB Vergi Türü Kodu: invoice_items."otherTaxCode" (VARCHAR(10)).
-- 0059 Konaklama / 4071 Elektrik-Havagazı / 4080 ÖİV. GİB payload'ında tax[].taxCode
-- ZORUNLU — kod boş giderse GİB şematronu "Geçersiz cbc:TaxTypeCode" ile reddeder.
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS "otherTaxCode" varchar(10);
