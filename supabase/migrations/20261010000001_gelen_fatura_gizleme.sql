-- Gelen e-faturayı listede gizleme (2026-10-10).
--
-- Kullanıcı ilgisiz gördüğü gelen faturayı (şubeye ait olmayan, mükerrer, Kobipo
-- dışında işlenmiş…) listeden kaldırır; belge silinmez, "Gizlenenler" görünümünden
-- geri alınır. Kural: lib/integrations/e-invoice/incoming-list-query.ts.
--
-- `isArchived` KULLANILMADI: o alan Mysoft'tan gelir ve her senkronda yeniden yazılır,
-- kullanıcının gizlemesi ilk senkronda geri açılırdı.
--
-- Yeni TABLO eklenmediği için RLS adımı yok; incoming_invoices kilidi yerinde.
--
-- SIRA ÖNEMLİ: kod deploy'dan ÖNCE uygulanmalı. Yeni Prisma istemcisi gelen faturayı
-- okurken bu kolonları seçer; kolon yoksa gelen fatura listesi, detayı ve birleşik
-- fatura listesi "column does not exist" ile düşer. Tekrar çalıştırılabilir.

ALTER TABLE public.incoming_invoices
  ADD COLUMN IF NOT EXISTS "hiddenAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "hiddenById" text;
