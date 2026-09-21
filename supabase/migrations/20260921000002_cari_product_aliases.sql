-- CARİ ÜRÜN EŞLEŞMESİ — belge taramanın öğrenen ürün haritası (plan §3.5).
--
-- NEDEN: fiş taramada kalem ↔ ürün eşleşmesi ad eşitliğiyle yapılıyordu
-- (trFold bile değil); tedarikçinin "LST-001 / FORKLİFT LASTİĞİ 7.00-12" satırı
-- bizim "Lastik 7.00-12" kartımızla asla eşleşmez. Kullanıcı ilk faturada
-- eşler, ikincisinden itibaren otomatik gelir.
--
-- ANAHTAR: satıcının ürün kodu varsa o, yoksa kalem adının Türkçe-katlanmış hâli
-- (lib/text/tr-fold.ts). Cari bazında: aynı kod iki tedarikçide farklı ürün olabilir.
-- Satış tarafında (matbu satış faturası) müşteri bazında aynı tablo kullanılır;
-- `cariId` tedarikçi ya da müşteri id'sidir (cuid, iki tabloda çakışmaz),
-- `cariKind` hangisi olduğunu söyler. Cari silinince satır kalır (zararsız,
-- yeniden eşleşmez); ürün silinince satır düşer.

CREATE TABLE IF NOT EXISTS public.cari_product_aliases (
  "id"         TEXT PRIMARY KEY,
  "companyId"  TEXT NOT NULL,
  "cariId"     TEXT NOT NULL,
  -- SUPPLIER | CUSTOMER
  "cariKind"   TEXT NOT NULL DEFAULT 'SUPPLIER',
  -- trFold(satıcı kodu) ya da trFold(kalem adı); boşluklar tek boşluğa indirilir
  "key"        TEXT NOT NULL,
  -- Ekranda gösterilen ham metin (kod / ad) — anahtar geri okunamaz
  "label"      TEXT,
  "productId"  TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hitCount"   INTEGER NOT NULL DEFAULT 1,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cari_product_aliases_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT "cari_product_aliases_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES public.products(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cari_product_aliases_companyId_cariId_key_key"
  ON public.cari_product_aliases ("companyId", "cariId", "key");

CREATE INDEX IF NOT EXISTS "cari_product_aliases_productId_idx"
  ON public.cari_product_aliases ("productId");

ALTER TABLE public.cari_product_aliases ENABLE ROW LEVEL SECURITY;
