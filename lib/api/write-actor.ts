// Yazma uçlarının "kim yazıyor, yetkisi var mı" bağımlılığı — oturumdan AYRI.
//
// Fiş, tahsilat ve adisyon kapanışı bugüne kadar yalnız oturumu olan bir istekle
// yazılabiliyordu (getCurrentUser + ensureCompanyWrite uç içinde). ÖKC bulut
// entegrasyonunda (docs/okc/ASAMA1-KOBIPO.md A5, Aşama 2) aynı iş, yazarkasadan
// gelen webhook'la SUNUCUDA yürüyecek; orada oturum yoktur. İş mantığı bu yüzden
// `WriteActor` alır:
//
//   userId    → kayıtlardaki `createdBy`
//   authorize → yetki; iş mantığının İÇİNDE, eskiden ensureCompanyWrite/Access'in
//               çağrıldığı noktada çağrılır (hata sırası değişmesin diye). Firmanın
//               modül durumunu döndürür: restoran uçları `assertRestaurantModule`e verir.
//
// Bu dosya oturum makinesini (next-auth, React cache) İÇE ALMAZ — webhook yolu
// ve Next dışı betikler onsuz yüklenebilsin. Oturumlu sarmalayıcılar:
// lib/api/session-actor.ts

import { prisma } from "@/lib/db/prisma"

export type CompanyGate = { disabledModules?: string[] }
export type Authorize = (companyId: string) => Promise<CompanyGate>

export type WriteActor = {
  userId: string
  authorize: Authorize
}

/**
 * OTURUMSUZ sistem çağrısı (ör. yazarkasa webhook'u). Kullanıcı yetkisi SORULMAZ —
 * çağıran, isteğin kaynağını KENDİSİ doğrulamış olmalı (webhook imzası/sırrı) ve
 * `companyId`yi kendi kaydından (cihaz → firma) almalıdır, istekten değil.
 *
 * Hesap kuralları yine uygulanır: firma yoksa, pasifse ya da arşivdeyse (salt-okunur
 * hesap) yazılmaz; modül durumu döndürülür ki kapalı modüle sistem de yazamasın.
 * `userId` kayıtlarda iz olarak durur: "system:okc" gibi.
 */
export function trustedSystemActor(userId: string): WriteActor {
  return {
    userId,
    authorize: async (companyId) => {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { disabledModules: true, archivedAt: true, isActive: true },
      })
      if (!company || !company.isActive) throw new Error("Access denied: company not found or inactive")
      if (company.archivedAt) throw new Error("Access denied: account archived (read-only)")
      return { disabledModules: company.disabledModules ?? [] }
    },
  }
}
