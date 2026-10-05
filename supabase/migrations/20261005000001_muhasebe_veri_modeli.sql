-- Muhasebe veri modeli eksikleri (docs/muhasebe/MOTOR-PLAN.md → "▶ DEVAM", 2026-10-05).
--
-- Dört yeni kolon, hepsi NULL olabilir: eski kod onları okumaz, yeni kod NULL'u "eski
-- kayıt" diye yorumlar. Bu yüzden DEPLOY'DAN ÖNCE uygulanır (yeni Prisma istemcisi
-- kolonları seçer; kolon yoksa sorgu düşer). Tekrar çalıştırılabilir.
--
-- Yeni TABLO yok → RLS dokunuşu gerekmiyor (tablolarda RLS zaten açık —
-- 20260811000003_rls_lockdown.sql).

-- 1) Bordro: SGK işveren payı (işsizlik sigortası işveren payı dahil) — tahakkuk fişine
--    B 770 · A 361 olarak girer. NULL = bu kolondan önceki bordro; muhasebe fişi
--    teşviksiz taban oranla hesaplar ve satır açıklamasında söyler
--    (lib/personel/bordro-hesap.ts → isverenSgkPayi).
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS "employerSgk" numeric(12, 2);

-- 2) Çek/senet: durumun DEĞİŞTİĞİ gün. Ciro fişi bugüne kadar evrakın son güncellenme
--    gününü (`updatedAt`) kullanıyordu — evraka sonradan not yazmak fiş tarihini kaydırıyordu.
--    Geçmiş tarihli bilanço/açılış portföyü de ciro edilmiş evrakı bugünkü durumuyla
--    sayıyordu (lib/raporlar/bilanco-kiymet.ts).
ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS "statusChangedAt" timestamp(3);
ALTER TABLE public.promissory_notes
  ADD COLUMN IF NOT EXISTS "statusChangedAt" timestamp(3);

-- Mevcut kayıtlar: bilinen en iyi tahmin son güncelleme günüdür (ciro fişinin bugüne
-- kadar kullandığı tarih — fişler değişmesin). Portföydeki evrakın durum tarihi yoktur.
UPDATE public.checks SET "statusChangedAt" = "updatedAt"
  WHERE status <> 'PORTFÖYDE' AND "statusChangedAt" IS NULL;
UPDATE public.promissory_notes SET "statusChangedAt" = "updatedAt"
  WHERE status <> 'PORTFÖYDE' AND "statusChangedAt" IS NULL;

-- 3) Hesaplar arası virman: iki bacağı bağlayan ortak kimlik. Bacaklar bugüne kadar
--    tutar + gün + referansla eşleştiriliyordu (lib/muhasebe/kaynaklar.server.ts →
--    virmanEslestir); canlıda virman bacağı yok, geriye dönük doldurulacak kayıt yok.
--    Kimliği olmayan (eski) bacak yine eski kuralla eşleşir.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS "transferGroupId" text;
CREATE INDEX IF NOT EXISTS "transactions_transferGroupId_idx"
  ON public.transactions ("transferGroupId");

-- 4) Dövizli kasa/banka hareketinin kuru: 1 birim döviz = ? TL. TRY harekette NULL.
--    Bugüne kadar dövizli hareket fişe hiç girmiyordu ("kur tutulmuyor"); canlıda dövizli
--    hesap ve hareket yok.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS "exchangeRate" numeric(18, 6);
