-- Kısıtlı çalışan izinleri: bir ekip üyesinin panelde hangi sayfaları görebileceği
-- ve hangilerinde yazabileceği.
--
-- NEDEN ROL YETMEDİ: rol (ADMIN/SALES/STOCK/...) firma bazında tek bir hazır paket
-- veriyor. "Kafedeki çalışan satıştan yalnız müşterileri görsün" gibi bir istek
-- rolle ifade edilemiyordu; en yakın rol (SALES) satış faturasını, teklifi, hızlı
-- satışı da açıyor.
--
-- MODEL — daraltma, genişletme değil: efektif izin = rol matrisi ∩ allowedPaths.
-- Listeye yazılan bir sayfa, rolün zaten göremediği bir ekranı AÇMAZ. Böylece rol
-- tek yetki kaynağı olarak kalır ve kazara yetki genişlemesi mümkün olmaz.
--
-- BOŞ DİZİ = KISIT YOK. `companies.disabledModules`un tersi bir varsayılan ve
-- bilinçli: orada red listesi doğruydu (satılmamış modül kapalı doğmalı), burada
-- izin listesi doğru olur — aksi halde panele eklenen her yeni sayfa TÜM mevcut
-- kullanıcılardan sessizce kaybolurdu. Bu migration çalıştıktan sonra hiçbir
-- mevcut üyeliğin davranışı değişmez.

ALTER TABLE "user_companies"
  ADD COLUMN IF NOT EXISTS "allowedPaths" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "user_companies"
  ADD COLUMN IF NOT EXISTS "writablePaths" TEXT[] NOT NULL DEFAULT '{}';

-- Personel kartı ↔ Kobipo hesabı bağı.
--
-- Yetki BU ALANDA DEĞİL, user_companies'te yaşar. Buradaki bağ yalnızca eşleştirme:
-- personel kartından "hesap aç/davet et" kısayolu ve vardiya/ikram kayıtlarının
-- giriş yapan kullanıcıyla birleşmesi. Personel modülü satın alınmamış bir firmada
-- da kısıtlı çalışan tanımlanabilsin diye izinler personel kartına bağlanmadı.
ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "employees_userId_idx" ON "employees" ("userId");

-- Bir hesap aynı firmada iki personel kartına bağlanamaz. NULL'lar Postgres'te
-- benzersizlik kısıtına takılmaz, yani hesabı olmayan personel sayısı serbest.
CREATE UNIQUE INDEX IF NOT EXISTS "employees_companyId_userId_key"
  ON "employees" ("companyId", "userId");

-- SET NULL: hesap silinse de personel kartı (bordro, izin, zimmet geçmişi) durur.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_userId_fkey'
  ) THEN
    ALTER TABLE "employees"
      ADD CONSTRAINT "employees_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
