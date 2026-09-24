// ÖKC ekranlarının rol kuralları — tek yer (istemci de okur).
//
// Sayfa kapısı (lib/page-access.ts) ucu hangi EKRANIN kullandığına göre açar;
// buradaki kurallar aynı ekranın içindeki İŞLEMİ ayırır: kasiyer Z raporu
// GİREBİLİR ama DÜZELTEMEZ/SİLEMEZ — girdiği rakamı sonradan değiştirebilseydi
// mutabakatın denetim değeri kalmazdı. Özel roller (CUSTOM) düzeltme yapamaz:
// izin şablonu "yazabilir"i girişle düzeltmeyi ayırt etmiyor.

const Z_EDIT_ROLES: readonly string[] = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT"]

export function canEditZReports(role: string | null | undefined): boolean {
  return role != null && Z_EDIT_ROLES.includes(role)
}
