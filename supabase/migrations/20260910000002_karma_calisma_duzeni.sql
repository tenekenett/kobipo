-- KARMA ÇALIŞMA DÜZENİ — bazı personel vardiyalı, bazısı sabit mesai.
--
-- Sorun: çalışma düzeni firma bazında TEK bir boolean'dı (`companies."usesShifts"`).
-- Karma işletme hangisini seçerse seçsin bir grubu yanlış ekrana düşüyordu:
-- "vardiyalı"da sabit mesaili personele saatli bar çizmek gerekiyor, "tek düze"de
-- vardiyalı personel devam özetinde koşulsuz "çalıştı" sayılıp bordroya yanlış
-- tabandan giriyordu.
--
-- Çözüm iki parçalı:
--   1) companies."workScheduleMode" — SHIFT | FLAT | MIXED (null = henüz sorulmadı).
--      Üçüncü cevap boolean'a sığmadığı için alan metne çevrildi; MIXED'de iki
--      takvim birden menüde durur.
--   2) employees."usesShifts" — bu çalışan vardiyalı mı? null = firmanın düzeni.
--      Karma işletmede kimin hangi takvimde olduğunun TEK kaynağı budur.
--
-- Bir çalışan HER ZAMAN tek takvime aittir: aynı kişi iki takvimde birden
-- görünseydi hem saat hem gün bordroya girer, kesinti iki kez sayılırdı.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "workScheduleMode" text;

-- Bir önceki migrasyonun (20260910000001) boolean cevabını taşı: true → SHIFT,
-- false → FLAT, null → null (soru hâlâ sorulmamış).
--
-- DO bloğu ŞART: dosya ikinci kez çalıştırıldığında `companies."usesShifts"` artık
-- yoktur ve çıplak bir UPDATE "column does not exist" ile patlardı. Bu depodaki
-- migrasyonlar tekrar çalıştırılabilir olmalı.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'usesShifts'
  ) THEN
    UPDATE public.companies
       SET "workScheduleMode" = CASE WHEN "usesShifts" THEN 'SHIFT' ELSE 'FLAT' END
     WHERE "usesShifts" IS NOT NULL
       AND "workScheduleMode" IS NULL;
  END IF;
END $$;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS "usesShifts";

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS "usesShifts" boolean;

-- Yeni tablo yok; companies ve employees zaten RLS altında
-- (20260811000003_rls_lockdown.sql).
