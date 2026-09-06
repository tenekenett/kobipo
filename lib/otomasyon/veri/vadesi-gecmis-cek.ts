/**
 * K-NKT-06 · "Vadesi geçtiği hâlde portföyde duran çek/senet."
 *
 * Vadesi dolmuş ama hâlâ PORTFÖYDE görünen evrak iki şeyden birini söyler ve
 * ikisi de kayıt boşluğudur:
 *
 *   ALINAN (RECEIVED) → ya tahsil edildi ve kaydı düşülmedi, ya karşılıksız
 *                       çıktı ve kimse fark etmedi.
 *   VERİLEN (GIVEN)   → ya ödendi ve kaydı düşülmedi, ya ödenmedi ve borç
 *                       hâlâ açık.
 *
 * Her hâlde nakit tablosu yanlıştır: `nakit-projeksiyon` bu evrakı geleceğe
 * taşımaz, cari bakiyesi ise kapanmış gibi durur.
 *
 * ── TOPLAM TUTAR BİLEREK YAZILMIYOR ─────────────────────────────────────────
 * Ölçümde (2026-09-06) tek firmada ₺3.213.123.123.123 tutarlı bir çek vardı.
 * Toplam alınsaydı kart "₺3,2 trilyon çek bekliyor" derdi ve okuyan kişi
 * kartların tamamına güvenmeyi bırakırdı. Bunun yerine EVRAKLAR TEK TEK
 * listelenir: saçma bir rakam tek bir satırda görünür, diğerlerini bozmaz.
 */

import { prisma } from "@/lib/db/prisma"
import { sayi, bugunBasi, gunFarki } from "@/lib/asistan/veri/temel"

/** Kartta adı geçecek evrak sayısı. */
export const ORNEK_EVRAK_SAYISI = 3

export type GecmisEvrak = {
  tur: "cek" | "senet"
  no: string
  tutar: number
  gecikmeGun: number
  karsiTaraf: string | null
  alinan: boolean
}

export type VadesiGecmisEvrakOzeti = {
  adet: number
  alinanAdet: number
  verilenAdet: number
  enUzunGun: number
  ornekler: GecmisEvrak[]
}

/**
 * Yön çözümü ESKİ KAYITLARI da kapsar: `direction` null ise şema yorumundaki
 * kural uygulanır — müşteri bağlıysa alınan, tedarikçi bağlıysa verilen.
 */
const alinanMi = (e: {
  direction: string | null
  customerId: string | null
}) => (e.direction ? e.direction === "RECEIVED" : Boolean(e.customerId))

export async function vadesiGecmisEvrakOzeti(
  companyId: string
): Promise<VadesiGecmisEvrakOzeti | null> {
  const bugun = bugunBasi()
  const kosul = {
    companyId,
    status: "PORTFÖYDE",
    dueDate: { lt: bugun },
  } as const
  const alanlar = {
    amount: true,
    dueDate: true,
    direction: true,
    customerId: true,
    customer: { select: { name: true } },
    supplier: { select: { name: true } },
  }

  const [cekler, senetler] = await Promise.all([
    prisma.check.findMany({
      where: kosul,
      select: { checkNo: true, ...alanlar },
      orderBy: { dueDate: "asc" },
    }),
    prisma.promissoryNote.findMany({
      where: kosul,
      select: { noteNo: true, ...alanlar },
      orderBy: { dueDate: "asc" },
    }),
  ])

  const hepsi: GecmisEvrak[] = [
    ...cekler.map((c) => ({
      tur: "cek" as const,
      no: c.checkNo,
      tutar: sayi(c.amount),
      gecikmeGun: gunFarki(bugun, c.dueDate),
      karsiTaraf: c.customer?.name ?? c.supplier?.name ?? null,
      alinan: alinanMi(c),
    })),
    ...senetler.map((s) => ({
      tur: "senet" as const,
      no: s.noteNo,
      tutar: sayi(s.amount),
      gecikmeGun: gunFarki(bugun, s.dueDate),
      karsiTaraf: s.customer?.name ?? s.supplier?.name ?? null,
      alinan: alinanMi(s),
    })),
  ]

  if (hepsi.length === 0) return null

  return {
    adet: hepsi.length,
    alinanAdet: hepsi.filter((e) => e.alinan).length,
    verilenAdet: hepsi.filter((e) => !e.alinan).length,
    enUzunGun: Math.max(...hepsi.map((e) => e.gecikmeGun)),
    // En uzun bekleyen önce: gecikme büyüdükçe "unutulmuş" olma ihtimali artar.
    ornekler: [...hepsi]
      .sort((a, b) => b.gecikmeGun - a.gecikmeGun)
      .slice(0, ORNEK_EVRAK_SAYISI),
  }
}
