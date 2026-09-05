-- BEDELSİZ VERİLEN MODÜLLER — firma bazında, satın alma olmadan açılan ücretli modüller.
--
-- Sorun: sistem yöneticisi bir firmaya ücretli modülü elle açtığında karar
-- `Subscription.purchasedModules`a yazılıyordu. Yetki ise her yeniden hesaplamada
-- `resolveGrantedModules` ile üretiliyor ve o fonksiyon, aboneliği ücretli-aktif OLMAYAN
-- firmada (deneme / süresi dolmuş / hiç aboneliği yok) boş küme döndürüyor. Sonuç: elle
-- açılan modül ilk reconcile'da, yinelenen ödemede ya da yeni siparişte sessizce
-- kapanıyordu. Uç bunu "durable=false" uyarısıyla söylüyor ama çözmüyordu.
--
-- Çözüm: bedelsiz verme AYRI ve kalıcı bir alanda tutulur. `applyEntitlements` açık
-- kümeye bunu (ve gereksinimlerini) EKLER — `suppressedModules`un tam aynadaki
-- karşılığıdır (o düşer, bu ekler).
--
-- Faturayla ilişkisi YOKTUR: burada duran modül "satın alınmış" sayılmaz, yalnız açıktır.
-- Satın alınanın kaydı `Subscription.purchasedModules` olmaya devam eder; ikisi
-- birleştirilseydi bedelsiz verilen modül abonelik yenilemesinde faturalanmaya başlardı.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "grantedModules" text[] NOT NULL DEFAULT ARRAY[]::text[];

-- companies zaten RLS altında (20260811000003_rls_lockdown.sql); yeni tablo yok.
