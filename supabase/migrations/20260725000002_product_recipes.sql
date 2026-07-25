-- Reçete (BOM) desteği: bir ürünün hangi bileşenlerden oluştuğu.
--
-- Satış anında mamülün KENDİSİ stoktan düşmez; bileşenleri düşer. Bir bileşenin
-- de reçetesi varsa (yarı mamül, ör. "Espresso") özyinelemeli olarak hammaddeye
-- kadar açılır — yarı mamüller SANALDIR, stok bakiyeleri tutulmaz.
--
-- Yarı mamül için ayrı bir tip/bayrak yoktur: yarı mamül = reçetesi olan ve
-- "isSellable" = false olan ürün. Genişletme kuralı tek cümledir:
-- "bileşenin aktif reçetesi VARSA açılır, YOKSA düşülür."
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

-- Satış/menü ekranlarında listelenir mi? Hammaddeler false yapılır.
-- Varsayılan true → mevcut hiçbir ürünün davranışı değişmez.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS "isSellable" boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.product_recipes (
  id              text PRIMARY KEY,
  "companyId"     text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Ürün başına tek reçete (aşağıdaki unique index).
  "productId"     text NOT NULL REFERENCES public.products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Reçete kaç adet mamül üretir; bileşen miktarları buna bölünür.
  "yieldQuantity" numeric(12, 4) NOT NULL DEFAULT 1,
  "isActive"      boolean NOT NULL DEFAULT true,
  note            text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_recipes_productId_key"
  ON public.product_recipes ("productId");

CREATE INDEX IF NOT EXISTS "product_recipes_companyId_idx"
  ON public.product_recipes ("companyId");

CREATE TABLE IF NOT EXISTS public.product_recipe_items (
  id                   text PRIMARY KEY,
  "recipeId"           text NOT NULL REFERENCES public.product_recipes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT: bir reçetede kullanılan hammadde silinemesin.
  "componentProductId" text NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Aşağıdaki "unit" cinsinden miktar; bileşenin STOK biriminden farklı olabilir
  -- (süt LT stoklanır, reçetede 200 ML geçer). Dönüşüm aynı birim ailesi içinde.
  quantity             numeric(14, 4) NOT NULL,
  unit                 text NOT NULL,
  "wastageRate"        numeric(5, 2),
  "order"              integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_recipe_items_recipeId_componentProductId_key"
  ON public.product_recipe_items ("recipeId", "componentProductId");

CREATE INDEX IF NOT EXISTS "product_recipe_items_componentProductId_idx"
  ON public.product_recipe_items ("componentProductId");
