/**
 * ÇALIŞMA DÜZENİ — kim vardiya takviminde, kim devam takviminde?
 *
 * İki eksen var ve karıştırılmamalı:
 *
 *   Company.workScheduleMode → hangi TAKVİMLER var (menüde ne duruyor)
 *   Employee.usesShifts      → bu ÇALIŞAN hangi takvimde
 *
 * Karma işletme üçüncü bir cevaptır: bazı personel vardiyalı (kafe servisi),
 * bazısı sabit mesai (ofis). Firma bazında tek boolean'la ifade edilemiyordu —
 * hangi taraf seçilirse öteki grup yanlış ekrana düşüyordu.
 *
 * DEĞİŞMEZ: bir çalışan HER ZAMAN tek takvime aittir. Aynı kişi iki takvimde
 * birden görünseydi saat toplamı da gün kesintisi de bordroya girer, aynı ay iki
 * kez faturalanırdı. Aşağıdaki `employeeUsesShifts` bu ayrımın tek kaynağıdır;
 * ekranlar, aylık özetler ve dışa aktarımlar hepsi buradan geçer.
 */

export type WorkScheduleMode = "SHIFT" | "FLAT" | "MIXED"

export const WORK_SCHEDULE_MODES: WorkScheduleMode[] = ["SHIFT", "FLAT", "MIXED"]

export const isWorkScheduleMode = (v: unknown): v is WorkScheduleMode =>
  typeof v === "string" && (WORK_SCHEDULE_MODES as string[]).includes(v)

/** Bilinmeyen/bozuk değeri "henüz sorulmadı"ya indirger. */
export const normalizeMode = (v: unknown): WorkScheduleMode | null =>
  isWorkScheduleMode(v) ? v : null

export const MODE_LABEL: Record<WorkScheduleMode, string> = {
  SHIFT: "Vardiyalı",
  FLAT: "Sabit mesai",
  MIXED: "Karma",
}

/**
 * Firmanın VARSAYILAN tarafı — personel kartında seçim yapılmadığında geçerli.
 *
 * Karma firmada varsayılan VARDİYALI'dır. Sebebi asimetri: devam takviminde
 * işaretlenmemiş gün "çalıştı" sayılır, yani yanlış tarafa düşen bir personel
 * sessizce "22 gün çalıştı" diye bordroya girer. Vardiya tarafında ise yanlış
 * düşen kişi yalnızca boş bir satır olarak görünür. Güvenli varsayılan, veri
 * UYDURMAYAN taraftır.
 *
 * Henüz sorulmamış firmada da (null) vardiya varsayılandır: bugüne kadarki
 * davranış budur ve kurulum penceresi soruyu zaten ilk açılışta sorar.
 */
export const defaultUsesShifts = (mode: WorkScheduleMode | null | undefined): boolean =>
  mode !== "FLAT"

/**
 * Bu çalışan vardiyalı mı?
 *
 * Personel kartındaki seçim (varsa) firmanın düzenini EZER — karma işletmenin
 * tek gerçek kaynağı budur. Seçim yoksa firmanın varsayılan tarafına düşer.
 */
export const employeeUsesShifts = (
  employee: { usesShifts?: boolean | null } | null | undefined,
  mode: WorkScheduleMode | null | undefined,
): boolean => (employee?.usesShifts ?? null) !== null
  ? Boolean(employee?.usesShifts)
  : defaultUsesShifts(mode)

/** Vardiya takviminde görünecek personel (saatli plan). */
export const shiftEmployees = <T extends { usesShifts?: boolean | null }>(
  employees: T[],
  mode: WorkScheduleMode | null | undefined,
): T[] => employees.filter((e) => employeeUsesShifts(e, mode))

/** Devam takviminde görünecek personel (çalıştı/izinli işaretlemesi). */
export const flatEmployees = <T extends { usesShifts?: boolean | null }>(
  employees: T[],
  mode: WorkScheduleMode | null | undefined,
): T[] => employees.filter((e) => !employeeUsesShifts(e, mode))

/** Vardiya takvimi bu firmada kullanılıyor mu (menü ve uyarı şeridi ölçüsü)? */
export const shiftCalendarEnabled = (mode: WorkScheduleMode | null | undefined): boolean =>
  mode !== "FLAT"

/** Devam takvimi bu firmada kullanılıyor mu? */
export const attendanceCalendarEnabled = (mode: WorkScheduleMode | null | undefined): boolean =>
  mode === "FLAT" || mode === "MIXED"

/**
 * Bu ekran firmanın çalışma düzenine göre YANLIŞ ekran mı (uyarı şeridi çıkar mı)?
 *
 * `mode` null iken ASLA uyarı verilmez ve bu kontrol açıkça yazılıdır: devam
 * ekranı için `attendanceCalendarEnabled(null)` false döner, yani null elenmezse
 * soruyu hiç cevaplamamış firmaya (ve firma listesi henüz yüklenmemişken herkese)
 * "vardiyalı olarak ayarlısınız" denirdi.
 *
 * KARMA işletmede de uyarı yoktur: orada iki takvim de firmanın kendi ekranıdır.
 */
export const wrongCalendarScreen = (
  ekran: "vardiya" | "devam",
  mode: WorkScheduleMode | null | undefined,
): boolean => {
  if (mode == null) return false
  return ekran === "vardiya" ? !shiftCalendarEnabled(mode) : !attendanceCalendarEnabled(mode)
}
