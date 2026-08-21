import { prisma } from "@/lib/db/prisma"
import { sanitizePagePermissions } from "@/lib/page-access"
import {
  DEFAULT_ROLE_TEMPLATES,
  toRoleTemplate,
  type RoleTemplate,
} from "./role-templates"

/**
 * Hazır rol kalıbı kataloğunu okur (sunucu tarafı).
 *
 * Kataloğun kaynağı `role_templates` tablosudur; sistem yönetim panelinden düzenlenir.
 * Tablo YOKSA kodda gömülü yedeğe düşeriz: migrasyonu elle uygulayan bir kurulumda
 * (bkz. scripts/apply-migration.js) sürüm önce çıkıp tablo sonra gelebiliyor ve o
 * aralıkta firmanın "Hazır kalıplar" bölümünün boşalması, çalışan rolü tanımlamayı
 * durdurmak demekti. Yedek yalnız bu aralık içindir — tablo geldiği an devre dışı.
 */
export async function listRoleTemplates(options?: {
  includeInactive?: boolean
}): Promise<RoleTemplate[]> {
  const model = roleTemplateModel()
  if (!model) {
    console.warn("Prisma istemcisi role_templates tanımıyor — kodda gömülü kalıplara düşüldü")
    return fallbackTemplates()
  }
  try {
    const rows = await model.findMany({
      where: options?.includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })
    return rows.map(toRoleTemplate)
  } catch (error) {
    if (!isMissingTableError(error)) throw error
    console.warn("role_templates tablosu yok — kodda gömülü kalıplara düşüldü")
    return fallbackTemplates()
  }
}

/** Yedek kalıplar; sıra alanı tohumdaki ile aynı olsun diye onlukla numaralanır. */
function fallbackTemplates(): RoleTemplate[] {
  return DEFAULT_ROLE_TEMPLATES.map((t, i) => ({ ...t, sortOrder: (i + 1) * 10 }))
}

/**
 * Prisma istemcisindeki katalog modeli — YOKSA undefined.
 *
 * `prisma generate` çalıştıktan sonra başlamamış bir sunucu (klasik: açık duran
 * `next dev`) modeli tanımaz ve `prisma.roleTemplate.findMany` "undefined okunamıyor"
 * diye patlar. O mesaj hiçbir şey anlatmıyor: migrasyonu UYGULAMIŞ olan yönetici
 * panelde "tablo yok" yazan bir uyarı görüp uygulanmış migrasyonu tekrar arıyor.
 * Ayırt edebilmek için modeli çağırmadan önce burada yokluyoruz.
 */
export function roleTemplateModel() {
  return (prisma as { roleTemplate?: typeof prisma.roleTemplate }).roleTemplate
}

/**
 * Katalog okunamadığında yöneticiye gösterilecek AYIRT EDİCİ sebep.
 * Firma tarafı yedeğe düştüğü için bu yalnız sistem yönetim panelinde görünür.
 */
export function describeCatalogError(error: unknown): string {
  if (!roleTemplateModel()) {
    return "Sunucudaki Prisma istemcisi role_templates tablosunu tanımıyor. `npx prisma generate` sonrası geliştirme sunucusunu yeniden başlatın."
  }
  if (isMissingTableError(error)) {
    return "role_templates tablosu yok: supabase/migrations/20260821000001_role_templates.sql uygulanmamış."
  }
  return error instanceof Error ? error.message : "Katalog okunamadı"
}

/**
 * Tablo henüz oluşturulmamış mı? Prisma bunu P2021 ile, ham sürücü 42P01 ile bildirir;
 * ikisini de yakalamak gerekiyor çünkü sorgu yolu (engine vs. hata sarmalama) sürüme
 * göre değişebiliyor. Başka hataları YUTMUYORUZ — bağlantı hatasını "tablo yok" sayıp
 * sessizce yedeğe düşmek, gerçek arızayı gizlerdi.
 */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === "P2021" || code === "42P01"
}

/**
 * Panelden gelen sayfa seçimini kalıba yazılabilir hâle getirir.
 *
 * Firma rolüyle AYNI süzgeci kullanır (`custom: true`): bilinmeyen href atılır, yazma
 * listesi görüntüleme listesinin alt kümesine indirilir ve hesap yönetimi ekranları
 * (Ekip, Şube, Abonelik, Şube Müdürleri) elenir. Süzgeci burada tekrarlamak yerine
 * ortak yordamı çağırmak şart: kalıp, uygulanamayacak bir yetki önerirse kullanıcı
 * kalıbı seçip kaydediyor ve sunucu sessizce farklı bir rol yazıyordu.
 */
export function sanitizeTemplatePaths(allowedInput: unknown, writableInput: unknown) {
  return sanitizePagePermissions("CUSTOM", allowedInput, writableInput, { custom: true })
}
