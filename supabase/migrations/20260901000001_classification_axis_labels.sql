-- Cari sınıflandırma EKSENLERİNİN adı (firma başına).
--
-- CompanyDefinition kümenin ÖĞELERİNİ tutuyor ("Bayi", "Marmara"); eksenin kendisi
-- adsızdı ve ekranlarda "Sınıflandırma 1 / 2" diye görünüyordu — kullanıcı hangi
-- eksene ne koyduğunu hatırlamak zorundaydı. Boş bırakılırsa eski etiketlere düşülür.
--
-- Yeni TABLO değil, mevcut tabloya kolon: RLS duruşu değişmiyor.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "classification1Label" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "classification2Label" VARCHAR(60);
