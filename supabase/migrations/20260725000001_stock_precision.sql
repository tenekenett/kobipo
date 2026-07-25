-- Stok miktar kolonlarının hassasiyetini 2 → 4 ondalığa çıkarır.
--
-- Gerekçe: reçeteli satışta (Restoran & Kafe modülü) mamül yerine bileşenleri düşeriz.
-- Kahve KG cinsinden tutulurken 20 gr = 0,02; 5 ml vanilya LT cinsinden 0,005 eder.
-- numeric(10,2) bu değerleri yuvarlayıp SESSİZCE kaybediyordu — gün sonunda stok kayar,
-- kimse fark etmez. numeric(14,4) ile en küçük temsil edilebilir miktar 0,0001 (0,1 gram).
--
-- Σ(warehouse_stocks.quantity) = products."stockQuantity" değişmezi korunduğu için
-- dört kolon da BİRLİKTE genişletilmelidir.
--
-- invoice_items.quantity BİLİNÇLİ OLARAK değiştirilmedi: satılan mamül adedi (1 latte)
-- için 2 ondalık yeterli ve UBL/e-Fatura tarafına dokunmamak gerekiyor.
--
-- Genişletme (widening) veri kaybetmez; mevcut değerler aynen korunur.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.products
  ALTER COLUMN "stockQuantity" TYPE numeric(14, 4),
  ALTER COLUMN "minStockLevel" TYPE numeric(14, 4);

ALTER TABLE public.warehouse_stocks
  ALTER COLUMN "quantity" TYPE numeric(14, 4);

ALTER TABLE public.stock_movements
  ALTER COLUMN "quantity" TYPE numeric(14, 4);
