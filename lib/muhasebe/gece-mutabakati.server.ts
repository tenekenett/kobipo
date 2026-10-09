import { prisma } from "@/lib/db/prisma"
import { defterBaglami, fisUretilirMi } from "@/lib/muhasebe/defter.server"
import { acilisSenkronla } from "@/lib/muhasebe/acilis.server"
import { senkronla } from "@/lib/muhasebe/senkron.server"

/**
 * GECE MUTABAKATI — kurulu her defterde fişleri kaynaklarıyla aynı tutar (2026-10-09, D).
 *
 * Fiş, belge yazılırken (`muhasebeyeBildir`) ve Fişler/Ayarlar ekranı açılırken üretilir.
 * Bildirmeyen seyrek yollar (toplu bordro, cari kartı açılış bakiyesi, eski içe aktarım,
 * stok değişince değişen açılış) ekran açılana kadar fişsiz kalıyordu; özet ekranı ve
 * mali tablolar o arada eksik rakam gösteriyordu. Bu iş her gece bütün defterleri tarar.
 *
 * Süre bütçeli: `deadline`ı aşan defter bir sonraki koşuya kalır (sonuçta `kalan`).
 * Senkron idempotent ve fiş kilidi altında: ekranla aynı anda koşması güvenlidir.
 * Sonuç yalnız SAYI taşır (Actions logu herkese açık olabilir).
 */
export async function geceMutabakati(opts: { deadline: number }) {
  const ayarlar = await prisma.accountingSettings.findMany({
    where: { planInstalledAt: { not: null } },
    select: { companyId: true },
    orderBy: { updatedAt: "asc" },
  })
  const sonuc = { defter: ayarlar.length, islenen: 0, acilan: 0, yenilenen: 0, silinen: 0, isaretlenen: 0, kalan: 0, hata: 0 }
  for (const { companyId } of ayarlar) {
    if (Date.now() > opts.deadline) {
      sonuc.kalan++
      continue
    }
    try {
      const ctx = await defterBaglami(companyId)
      if (!fisUretilirMi(ctx)) continue
      await acilisSenkronla(ctx)
      for (let tur = 0; tur < 20 && Date.now() < opts.deadline; tur++) {
        const o = await senkronla(ctx, { limit: 300 })
        sonuc.acilan += o.acilan
        sonuc.yenilenen += o.yenilenen
        sonuc.silinen += o.silinen
        sonuc.isaretlenen += o.isaretlenen
        if (o.kalan === 0) break
      }
      sonuc.islenen++
    } catch (e) {
      sonuc.hata++
      console.error("[muhasebe-gece] defter mutabakatı çöktü:", companyId, e)
    }
  }
  return sonuc
}
