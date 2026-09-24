// Oturumlu uçların `WriteActor`ü — kapı (sayfa + rol + arşiv) ensureCompanyWrite/Access'tir.
// Tip ve oturumsuz sistem aktörü: lib/api/write-actor.ts (oturum makinesini içe almaz).

import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import type { Authorize, WriteActor } from "@/lib/api/write-actor"

/** Uçlar için: oturumdaki kullanıcı + firmaya yazma yetkisi (sayfa kapısı dahil). */
export function sessionWriteActor(userId: string): WriteActor {
  return { userId, authorize: (companyId) => ensureCompanyWrite(companyId) }
}

/** Uçlar için OKUMA yetkisi (ör. kapanış gövdesini hazırlayan GET). */
export const sessionReadAuthorize: Authorize = (companyId) => ensureCompanyAccess(companyId)
