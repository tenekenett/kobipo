-- TEMEL (ÜCRETSİZ) MODÜLLER — "herkese açık gelen" modül kümesinin tek kaynağı.
--
-- Bugüne kadar modül YALNIZCA satın almayla açılıyordu (bkz. docs/paket-abonelik/
-- MODUL-KILIDI.md): yeni firma tüm modüller kapalı doğuyor, `applyEntitlements`
-- yalnız `Subscription.purchasedModules`tan üretiyordu. Artık sistem yöneticisi bir
-- modülü "temel" işaretleyebiliyor; o modül her hesapta ücretsiz ve açık gelir,
-- siparişte ücretlendirilmez.
--
-- Alan neden PricingItem üzerinde: her yönetilebilir modülün zaten burada bir satırı
-- var ("module:sales", ...) ve sistem-admin fiyat tablosu bu satırları düzenliyor.
-- Ayrı bir tablo/ayar anahtarı ikinci bir kaynak yaratırdı.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.pricing_items
  ADD COLUMN IF NOT EXISTS "isFree" boolean NOT NULL DEFAULT false;

-- Kota kalemleri (ek şube / ek firma) ücretsiz yapılamaz: onlar modül değil, sayaçtır.
UPDATE public.pricing_items SET "isFree" = false WHERE key NOT LIKE 'module:%';

-- pricing_items zaten RLS altında (20260811000003_rls_lockdown.sql); yeni tablo yok.
