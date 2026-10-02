-- FİRMA KAŞESİ (2026-10-02) — makbuzlarda firmanın imza alanına basılan kaşe/imza.
--
-- Öncesinde kaşe yalnız e-Dönüşüm şablon tasarımcısında (einvoice_templates.options
-- ->> 'stampDataUri') yüklenebiliyordu; e-Dönüşüm kullanmayan firmanın kaşe koyacak
-- yeri yoktu. Ayarlar → Firma Bilgileri'nden yüklenen (ya da şablondan alınan) kaşe
-- burada durur; yoksa makbuz yine şablondaki kaşeyi basar (lib/company/stamp.ts).
--
-- Neden companies üzerinde kolon DEĞİL: Prisma select'siz her firma okumasında tüm
-- kolonları seçer — 100 KB'lık görsel her isteğe binerdi, üstelik migrasyon deploy'dan
-- sonra kalırsa firma okuyan her ekran düşerdi. Ayrı tabloda eksikliği yalnız kaşe
-- okumasını etkiler (o da loglanıp şablon kaşesine düşer).
--
-- Firma başına tek satır. Görsel sunucuda PNG'ye normalleştirilmiş data URI'dir.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

CREATE TABLE IF NOT EXISTS public.company_stamps (
  "companyId" TEXT PRIMARY KEY,
  "dataUri"   TEXT NOT NULL,
  -- Makbuzdaki basım genişliği (mm); yükseklik görselin oranından gelir.
  "widthMm"   INTEGER NOT NULL DEFAULT 40,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "company_stamps_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE
);

ALTER TABLE public.company_stamps ENABLE ROW LEVEL SECURITY;
