-- Ürün kartında marka.
--
-- Kategoriyle AYNI model: ürünün kendi `brand` metni + firma bazlı öneri listesi
-- (company_definitions, type = PRODUCT_BRAND). NULL = marka girilmemiş; mevcut
-- ürünler etkilenmez.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS açılacak"):
-- products ve company_definitions tablolarının kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).
--
-- SIRA ÖNEMLİ: kod deploy'dan ÖNCE uygulanmalı. Yeni kod ürün listesinde `brand`
-- kolonunu okur; kolon yoksa stok ekranı "column does not exist" ile düşer.

ALTER TYPE "CompanyDefinitionType" ADD VALUE IF NOT EXISTS 'PRODUCT_BRAND';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand text;

CREATE INDEX IF NOT EXISTS "products_companyId_brand_idx"
  ON public.products ("companyId", brand);
