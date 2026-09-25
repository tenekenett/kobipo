-- ÜCRETSİZ PAKET ARTIK ALINARAK AÇILIR — firma bazında "ücretsiz paketi etkinleştirdi" damgası.
--
-- Öncesi: yeni firma temel (ücretsiz, `PricingItem.isFree`) modüller AÇIK doğuyordu ve
-- `applyEntitlements` onları abonelikten bağımsız olarak her uygulamada geri açıyordu.
-- Karar (2026-09-25): ücretsiz de olsa paket abonelik ekranından alınmalı. Yeni firma
-- tüm modüller kapalı doğar; 0 TL'lik sipariş damgayı basar, temel modüller o an açılır.
--
-- MEVCUT FİRMALAR DAMGALANIR: bugün temel modüllerle çalışan hiçbir firmanın modülü
-- kapanmamalı. Ölçü zamana değil DURUMA bakar — "firmada en az bir modül açık" (yani
-- `disabledModules` yedi modülün hepsini içermiyor). Böylece dosya tekrar çalıştırılabilir:
-- yeni kodla açılan firma tüm modüller kapalı doğduğu için damgalanmaz, ama migrasyon ile
-- deploy arasında ESKİ kodla açılmış (temel modülleri açık) bir firma yakalanır. Deploy'dan
-- hemen sonra bir kez daha çalıştırılması bu pencereyi kapatır.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "freeModulesClaimedAt" timestamp(3);

UPDATE public.companies
   SET "freeModulesClaimedAt" = "createdAt"
 WHERE "freeModulesClaimedAt" IS NULL
   AND NOT ("disabledModules" @> ARRAY['sales','purchase','stock','finance','reports','hr','restaurant']::text[]);

-- companies zaten RLS altında (20260811000003_rls_lockdown.sql); yeni tablo yok.
