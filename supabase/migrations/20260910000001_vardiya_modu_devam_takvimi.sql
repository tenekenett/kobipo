-- Vardiya modu + devam takvimi + net ücret.
--
-- 1) companies."usesShifts"  → işletme vardiyalı mı çalışıyor? (null = henüz sorulmadı)
--    Vardiya takvimi tek düze çalışan işletmede kafa karıştırıyordu: personel modülünün
--    ilk açılışında soru sorulur, cevaba göre menüde ya "Vardiya Takvimi" ya "Devam
--    Takvimi" durur. Üç değerli olması şart — "false" (vardiya yok) ile "hiç sorulmadı"
--    aynı şey değil; boolean varsayılanı false olsaydı soru hiç sorulamazdı.
--
-- 2) attendance_days          → tek düze çalışmanın günlük devam kaydı (çalıştı/izinli/…)
--    Bordroya gün kesintisi buradan çıkar. Satır = İSTİSNA: kayıt yoksa gün, onaylı
--    izin / işletme tatili / kapalı gün / "çalıştı" sırasıyla türetilir.
--
-- 3) employees."netSalary" + "salaryBasis" → net ücret ve anlaşmanın hangi uçtan
--    yapıldığı. Türkiye'de anlaşma çoğu zaman NET üzerinden yapılır; brüt ondan
--    türetilir. Brütten net her ay değişir (kümülatif gelir vergisi matrahı), bu
--    yüzden hangisinin SÖZLEŞME olduğu ayrıca yazılır.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "usesShifts" boolean;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS "netSalary" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "salaryBasis" text DEFAULT 'GROSS';

CREATE TABLE IF NOT EXISTS public.attendance_days (
  id           TEXT PRIMARY KEY,
  "companyId"  TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "workDate"   DATE NOT NULL,
  status       TEXT NOT NULL,
  note         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"  TEXT,
  "updatedBy"  TEXT,
  CONSTRAINT "attendance_days_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT "attendance_days_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES public.employees(id) ON DELETE CASCADE
);

-- Bir personelin bir gününde tek durum olur; ikinci satır kesintiyi iki kez saydırırdı.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_days_employeeId_workDate_key"
  ON public.attendance_days ("employeeId", "workDate");

CREATE INDEX IF NOT EXISTS "attendance_days_companyId_workDate_idx"
  ON public.attendance_days ("companyId", "workDate");

-- Proje kuralı: public şemadaki her tablo RLS açık ve policy'siz (default deny).
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
