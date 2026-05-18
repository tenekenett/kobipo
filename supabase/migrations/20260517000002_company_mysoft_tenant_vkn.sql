-- Mysoft API kullanıcısının yetkili olduğu mükellefin VKN/TCKN'si.
-- Kobipo firma VKN'si (`taxNumber`) ile Mysoft tenant VKN'si farklı olabilir
-- (özellikle test ortamında ve bayi entegrasyonlarında). Bu kolon Mysoft
-- Tenant endpoint'lerine (numaratör listesi/ekleme, fatura gönderme) iletilir.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "eDonusumTenantVkn" VARCHAR(11);
