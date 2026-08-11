-- RLS kilidi: public şemadaki TÜM tablolarda satır güvenliğini açar ve Data API
-- rollerinin (anon / authenticated) şemaya erişimini kalıcı olarak kapatır.
--
-- NEDEN GEREKLİ
-- Bu projede veriyi bugün tek başına *grant* katmanı koruyor: anon/authenticated
-- rollerinin public şemada USAGE yetkisi yok, bu yüzden PostgREST her isteğe
-- "permission denied for schema public" diyor. Ama RLS hiç devrede değil (77
-- tablonun 48'inde kapalı, açık olan 29'unda 0 policy). Yani Supabase panelinden
-- şema Data API'ye açılırsa ya da biri GRANT USAGE ON SCHEMA public TO anon
-- çalıştırırsa, tek adımda companies / invoices / employees / payroll_records /
-- password_reset_tokens dahil 48 tablo herkese açılır. RLS ikinci duvardır.
--
-- NEDEN UYGULAMAYI BOZMAZ
-- Uygulama Prisma ile `postgres` rolüne bağlanıyor; bu rol tabloların SAHİBİ ve
-- rolbypassrls=true. Sahip ve bypass rolleri RLS'i atlar — FORCE ROW LEVEL
-- SECURITY kullanılmadığı sürece, ki bilerek kullanılmıyor. Canlı kanıt: RLS
-- `companies` tablosunda zaten AÇIKTI ve uygulama her zaman okuyabildi.
-- Policy YAZILMIYOR: policy'siz RLS = "sahip dışında hiç kimseye hiçbir satır".

-- 1) Public şemadaki her tabloda RLS'i aç (zaten açık olanlara dokunmaz).
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind IN ('r', 'p')   -- normal + bölümlenmiş tablolar
       AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.tbl);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS açıldı: % tablo', n;
END $$;

-- 2) Data API rollerinin şema + nesne yetkilerini açıkça geri al. Şu an zaten
--    yoklar; bu ifadeler durumu "kazara olmuş" olmaktan çıkarıp niyet beyanına
--    çevirir ve panelden yapılan bir açmayı da geri alır.
REVOKE ALL ON SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 3) Fonksiyonlarda EXECUTE varsayılan olarak PUBLIC'e (yani anon dahil herkese)
--    verilir — slug trigger fonksiyonlarımız bu yüzden anon'a açık görünüyordu.
--    PUBLIC'ten geri alıyoruz; sahibi (postgres) yetkisini korur, trigger'lar
--    postgres bağlantısı üzerinden çalıştığı için etkilenmez.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 4) Bundan sonra postgres'in public şemada oluşturacağı nesnelerde de Data API
--    rollerine varsayılan yetki verilmesin. (Yalnız varsayılanları etkiler;
--    sonradan elle çalıştırılan bir GRANT'i engellemez — asıl duvar 1. adım.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 5) Kendi kendini doğrula: tek bir tablo bile RLS'siz kaldıysa migrasyonu
--    komple geri al (apply-migration.js hepsini tek transaction'da çalıştırır).
DO $$
DECLARE eksik int;
BEGIN
  SELECT count(*) INTO eksik
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity;
  IF eksik > 0 THEN
    RAISE EXCEPTION 'RLS açılamayan % tablo kaldı — migrasyon geri alınıyor', eksik;
  END IF;
  RAISE NOTICE 'Doğrulandı: public şemadaki tüm tablolarda RLS açık';
END $$;
