-- Faturasız (serbest) kasa hareketlerine KATEGORİ ve ETİKET.
--
-- ÖNCESİ: `invoices` baştan beri `category` (tek) + `tags[]` (çoklu) taşıyordu ve
-- fatura editöründe dolduruluyordu; `transactions` ise hiçbir sınıflandırma
-- taşımıyordu. Sonuç: kira, maaş, yakıt gibi FATURASIZ giderler gelir-gider
-- raporunda tek bir "Faturasız işlemler" satırında toplanıyor, "personel gideri
-- ne kadar" sorusu cevapsız kalıyordu. Paraşüt'ün Harcamalar Raporu'nun karşılığı
-- tam olarak bu kırılımdır.
--
-- Model faturayla AYNI (ayrı tablo yok, serbest metin + mevcut değerlerden
-- öneri): iki tarafın kategori kümesi ortak okunabilsin diye. Ayrı bir enum ya da
-- kategori tablosu, faturadaki "Kira" ile işlemdeki "Kira"yı iki farklı şey
-- yapardı.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS
-- açılacak"): transactions tablosunun kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS "category" text,
  ADD COLUMN IF NOT EXISTS "tags"     text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Rapor kırılımı (companyId, category) üzerinden gruplar; faturadaki indeksin eşi.
CREATE INDEX IF NOT EXISTS "transactions_companyId_category_idx"
  ON public.transactions ("companyId", "category");
