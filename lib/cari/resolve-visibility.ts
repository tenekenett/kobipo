/**
 * Oturumdaki kullanıcının bir firmadaki cari görünürlüğü.
 *
 * Kuralın kendisi `lib/cari/visibility.ts`te ve orası SAF tutuluyor (istemci
 * bileşeni de okuyor); oturum/Prisma bağımlılığı bu dosyada izole.
 */

import { getUserContext } from "@/lib/auth/user-context"
import { CARI_VISIBILITY_ALL, cariVisibilityFor, type CariVisibility } from "@/lib/cari/visibility"

/**
 * `ensureCompanyAccess`ten SONRA çağrılır: erişimin kendisini o doğrular, burası
 * yalnız "hangi cariler" sorusunu yanıtlar. Oturum ya da üyelik yoksa FIRLATIR —
 * sessizce "hepsi"ne düşmek, kapıyı hiç açmadan geçirirdi.
 */
export async function resolveCariVisibility(companyId: string): Promise<CariVisibility> {
  const context = await getUserContext()
  if (!context) throw new Error("Unauthorized")
  if (context.isSuperAdmin) return CARI_VISIBILITY_ALL

  const membership = context.companies.find((entry) => entry.companyId === companyId)
  if (!membership) throw new Error("Access denied to this company")

  return cariVisibilityFor(membership.role, context.userId, false)
}
