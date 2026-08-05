-- Firma slug'ı artık şube ismini de içerir.
--
-- Neden: şube eklerken ünvan ana firmadan DEVRALINIYOR (aynı tüzel kişi). Slug yalnız
-- `name`den üretildiği için ana firma "abc-gida" iken şubeler "abc-gida-2", "abc-gida-3"
-- oluyordu — SEF URL'in okunabilirlik amacı kayboluyordu. Şube ismi eklenince
-- "abc-gida-kadikoy" üretilir; ad çakışırsa -2/-3 eki mantığı aynen korunur.
--
-- Yalnızca BEFORE INSERT trigger'ını besler → MEVCUT satırların slug'ı değişmez
-- (değişseydi kayıtlı ?company=<slug> bağlantıları kırılırdı). 20260703000003'teki
-- fonksiyonun yerini alır; geri almak için o dosyadaki set_company_slug gövdesini
-- yeniden CREATE OR REPLACE etmek yeterlidir.

CREATE OR REPLACE FUNCTION set_company_slug() RETURNS trigger AS $$
BEGIN
  IF NEW."slug" IS NULL OR NEW."slug" = '' THEN
    NEW."slug" := kobipo_unique_company_slug(
      kobipo_slugify(
        NEW."name" || COALESCE(' ' || NULLIF(TRIM(NEW."branchName"), ''), '')
      )
    );
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
