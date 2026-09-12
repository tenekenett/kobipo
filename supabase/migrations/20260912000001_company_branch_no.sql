-- ŞUBE NO — şubenin kestiği e-belgede görünen şube numarası.
--
-- Sorun: şube, ana firmanın VKN'siyle fatura keser. Mysoft satıcı ünvan/adresini VKN
-- başına tuttuğu MÜKELLEF kaydından yazdığı için (fatura gövdesinde satıcı adresi alanı
-- yoktur) farklı adresteki şubenin faturası ana firmanın adresiyle gidiyordu.
--
-- Çözüm: şubenin kendi adresi belgeye UBL `cac:AgentParty` ("ŞUBE BİLGİLERİ") olarak
-- yazılır (Mysoft `supplierAgentAccount`). Ölçüldü: Mysoft bu bloğu ŞUBE NUMARASI
-- olmadan üretmiyor — "SupplierParty.agentNumber null olamaz." — ve numarayı belgeye
-- <cbc:ID schemeID="SUBENO"> olarak basar. Uydurma numara resmî belgeye girmesin diye
-- numara firmadan okunur.
--
-- NULL = "1" varsayılır (tek şubeli firma için doğru). Birden çok şubesi olan firma
-- burayı doldurmalı; yoksa iki şube belgede aynı numarayla görünür.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "branchNo" VARCHAR(10);

-- companies zaten RLS altında (20260811000003_rls_lockdown.sql); yeni tablo yok.
