-- Ürün Etiket Tasarımcısı: label_templates tablosu.
-- Firma (şube) kapsamlı etiket tasarım şablonları; design = versiyonlu element
-- ağacı (jsonb, bkz. lib/labels/types.ts LabelDesign).
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).
-- Slug: kobipo_slugify/kobipo_unique_slug/set_slug_from_name yardımcıları
-- 20260703000002_more_slugs.sql ile DB'de mevcut (TG_TABLE_NAME ile tablo-bağımsız).

CREATE TABLE IF NOT EXISTS public.label_templates (
  id          text PRIMARY KEY,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL DEFAULT '',
  "labelType" text NOT NULL DEFAULT 'ROLL',
  design      jsonb NOT NULL,
  "isDefault" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "label_templates_companyId_slug_key"
  ON public.label_templates ("companyId", slug);

CREATE INDEX IF NOT EXISTS "label_templates_companyId_idx"
  ON public.label_templates ("companyId");

-- INSERT'te boş slug'ı name'den üret (firma-içi benzersiz; -2, -3 ... ekler).
DROP TRIGGER IF EXISTS "trg_label_templates_slug" ON public.label_templates;
CREATE TRIGGER "trg_label_templates_slug"
  BEFORE INSERT ON public.label_templates
  FOR EACH ROW EXECUTE FUNCTION set_slug_from_name();
