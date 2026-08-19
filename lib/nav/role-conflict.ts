/**
 * Özel rol kaydının POST mu PATCH mi olacağına karar veren saf mantık.
 *
 * Ayrı dosyada duruyor çünkü asıl hata buradaydı: arayüz "düzenliyorum" sanılan akışta
 * yeni rol açmayı deniyor, `(companyId, name)` UNIQUE'ine çarpıp 409 döndürüyordu ve
 * kullanıcıya çıkış yolu sunulmuyordu. Karar bileşenin içinde kaldığı sürece test
 * edilemiyordu; buraya çıkınca `lib/**` test kapsamına giriyor.
 */

export type NamedRole = { id: string; name: string }

/** Rol adları karşılaştırılırken büyük/küçük harf ve kenar boşlukları önemsizdir. */
export function normalizeRoleName(value: string): string {
  // Türkçe locale şart: "İSTANBUL" → "istanbul", "ISTANBUL" → "ıstanbul". Varsayılan
  // locale ikisini de "istanbul" yapıp DB'nin ayırdığı iki adı aynı sayardı.
  return value.trim().toLocaleLowerCase("tr")
}

/**
 * Yazılan ad, düzenlenen rolün DIŞINDA bir rolle çakışıyor mu?
 *
 * `editingId` hariç tutulur: bir rolü kendi adıyla kaydetmek çakışma değildir.
 */
export function findRoleNameConflict<T extends NamedRole>(
  roles: readonly T[] | undefined,
  name: string,
  editingId: string | null
): T | null {
  const typed = normalizeRoleName(name)
  if (!typed || !roles?.length) return null
  return roles.find((role) => role.id !== editingId && normalizeRoleName(role.name) === typed) ?? null
}

/**
 * Kayıt hangi role gidecek? `null` → yeni rol (POST), id → o rolü güncelle (PATCH).
 *
 * Çakışan ada rağmen POST atmak 409'dan başka bir şey üretemez; o yüzden çakışma varsa
 * hedef her zaman mevcut roldür. Kullanıcı bunu düğme etiketinden görür.
 */
export function roleWriteTarget(editingId: string | null, conflict: NamedRole | null): string | null {
  return editingId ?? conflict?.id ?? null
}
