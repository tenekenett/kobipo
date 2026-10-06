-- Kamu kurumuna e-Fatura: müşteri kartında IBAN seçimi ve harcama birimi (2026-10-06).
--
-- Kamuya kesilen e-Faturada ödemenin yatırılacağı IBAN belgede zorunlu; Kobipo bu alanı
-- hiç göndermiyordu ve ilk kamu alıcısında (Eren Vinç → Pamukkale Üniversitesi) Mysoft
-- taslağı reddetti. Kural: lib/integrations/e-invoice/public-invoice.ts.
--
-- Altı kolon, hepsi boş/false başlar: eski kod onları okumaz. DEPLOY'DAN ÖNCE uygulanır —
-- yeni Prisma istemcisi müşteri okurken kolonları seçer, kolon yoksa cari ekranları düşer.
-- Tekrar çalıştırılabilir. Yeni TABLO yok → RLS dokunuşu gerekmiyor.

-- Kamu kurumu mu? GİB kaydı (gibUserType = 2) gönderimde bunu kendisi söyler ve bayrağı
-- basar; elle de açılabilir (GİB sorgusu yapılamadığında belge yine IBAN'lı gitsin).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS "isPublicInstitution" boolean NOT NULL DEFAULT false;

-- Ödemenin yatırılacağı hesap (belgede PaymentMeans/PayeeFinancialAccount = IBAN).
-- Boşsa firmanın TEK uygun banka hesabı kullanılır; birden çoksa seçim zorunludur.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS "publicPaymentAccountId" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_publicPaymentAccountId_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT "customers_publicPaymentAccountId_fkey"
      FOREIGN KEY ("publicPaymentAccountId") REFERENCES public.financial_accounts(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "customers_publicPaymentAccountId_idx"
  ON public.customers ("publicPaymentAccountId");

-- Ödemeyi yapacak HARCAMA BİRİMİ (belgede BuyerCustomerParty). Belgenin alıcısı çoğu
-- zaman muhasebe birimidir; harcama birimi kurumdan öğrenilir, tahmin edilmez.
-- VKN boşsa belge KAMU profiline geçmez, yalnız IBAN eklenir.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS "publicPayeeVkn" text,
  ADD COLUMN IF NOT EXISTS "publicPayeeName" text,
  ADD COLUMN IF NOT EXISTS "publicPayeeCity" text,
  ADD COLUMN IF NOT EXISTS "publicPayeeDistrict" text;
