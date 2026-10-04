import { prisma } from "@/lib/db/prisma"
import { defterBaglami, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { altHesaplariHazirla, planKur } from "@/lib/muhasebe/hesap-plani.server"
import { acilisSenkronla } from "@/lib/muhasebe/acilis.server"
import { senkronla, type SenkronOzeti } from "@/lib/muhasebe/senkron.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

/**
 * KURULUM (plan §2.2) — modülün ilk açılışı ve başlangıç tarihi değişikliği.
 *
 *   1. başlangıç tarihi yazılır (varsayılan: içinde bulunulan yılın 1 Ocak'ı)
 *   2. Tekdüzen planı firmaya yazılır (idempotent), kasa/banka/kart alt hesapları açılır
 *   3. açılış fişi TASLAK olarak kurulur
 *   4. geçmiş belgelerin taslak fişleri mutabakat döngüsüyle üretilir (istemci sayfalar)
 *
 * Başlangıç tarihi ONAYLI fiş varken değiştirilemez: onaylı fişlerin bir kısmı yeni
 * tarihin dışında kalır ya da açılışla çakışır. Önce onaylar geri alınır.
 */
export async function muhasebeKur(
  companyId: string,
  baslangic: Date,
  kullaniciId: string,
): Promise<DefterBaglami & { ayar: MuhasebeAyari }> {
  const ctx0 = await defterBaglami(companyId)
  if (!ctx0) throw new FisHatasi("Firma bulunamadı", 404)
  if (ctx0.defterId !== companyId) {
    throw new FisHatasi("Muhasebe ana firmada kurulur; şubenin belgeleri ana firmanın defterine yazılır.")
  }
  if (!ctx0.modulAcik) throw new FisHatasi("Muhasebe modülü bu firmada açık değil.", 403)

  if (ctx0.ayar && ctx0.ayar.startDate.getTime() !== baslangic.getTime()) {
    const onayli = await prisma.journalVoucher.count({ where: { companyId, status: "POSTED" } })
    if (onayli > 0) {
      throw new FisHatasi(
        `Başlangıç tarihi ${onayli} onaylı fiş varken değiştirilemez. Önce onayları geri alın.`,
        409,
      )
    }
  }

  await prisma.accountingSettings.upsert({
    where: { companyId },
    create: { companyId, startDate: baslangic, updatedBy: kullaniciId },
    update: { startDate: baslangic, updatedBy: kullaniciId },
  })

  await planKur(companyId)
  // Kasa/banka/kart alt hesapları kurulumda açılır: hesap planında hemen görünsünler.
  const finans = await prisma.financialAccount.findMany({
    where: { companyId: { in: ctx0.sirketIds } },
    select: { id: true, name: true, type: true },
  })
  await altHesaplariHazirla(
    companyId,
    finans.map((f) => ({ tur: "finans" as const, id: f.id, ad: f.name, altTur: f.type })),
  )
  await prisma.accountingSettings.update({
    where: { companyId },
    data: { planInstalledAt: new Date() },
  })

  const ctx = await defterBaglami(companyId)
  if (!ctx?.ayar) throw new Error("Kurulum yazılamadı")
  const kurulu = ctx as DefterBaglami & { ayar: MuhasebeAyari }
  await acilisSenkronla(kurulu)
  return kurulu
}

/**
 * Mutabakatın bir adımı: (ilk adımda) açılış fişi + en çok `limit` senkron eylemi.
 * İstemci `kalan` sıfırlanana kadar çağırır — sunucusuz ortamda tek istekte bütün
 * geçmişi üretmek süre sınırına takılırdı.
 */
export async function mutabakatAdimi(
  ctx: DefterBaglami & { ayar: MuhasebeAyari },
  opts: { acilis?: boolean; limit?: number } = {},
): Promise<SenkronOzeti> {
  if (opts.acilis) await acilisSenkronla(ctx)
  return senkronla(ctx, { limit: opts.limit ?? 150 })
}
