-- ELLE KAPATILAN TEMEL (ÜCRETSİZ) MODÜLLER — firma bazında kalıcı kapatma.
--
-- Sorun: ücretsiz modül kümesi `PricingItem.isFree`ten akıyor ve `applyEntitlements`
-- her uygulamada onu firmanın açık modüllerine EKLİYOR. Bu yüzden sistem yöneticisi
-- `disabledModules`a "kapalı" yazsa bile ilk yeniden hesaplamada (reconcile, yinelenen
-- ödeme, yeni sipariş) modül geri açılıyordu — panelde anahtar bu nedenle devre dışı
-- gösteriliyordu ve "firmanın modüllerine müdahale edemiyoruz" şikâyeti buradan çıktı.
--
-- Çözüm: kapatma kararı ayrı ve kalıcı bir alanda tutulur; `applyEntitlements` açık
-- kümeden bunu (ve buna BAĞIMLI modülleri) düşer.
--
-- Kapsam FİRMA bazındadır. Satın alma hesaba (kök firma + şubeler + ek firmalar)
-- yapılır ama elle kapatma düzenlenen firmayı bağlar; hesabın tümüne uygulamak
-- sistem-admin kartındaki açık seçimle olur.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "suppressedModules" text[] NOT NULL DEFAULT ARRAY[]::text[];

-- companies zaten RLS altında (20260811000003_rls_lockdown.sql); yeni tablo yok.
