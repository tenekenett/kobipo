/**
 * OTOMASYON KARTLARININ GÜNLÜĞÜ — gösterim ve karar kaydı.
 *
 * Bu dosya bir ölçüm aracı gibi görünüyor ama asıl işi VERİ BİRİKTİRMEK. Kartlar
 * yayına girdiği andan itibaren her gösterim etiketli bir veri noktasıdır:
 * "şu firmaya şu kart şu rakamlarla gösterildi, kullanıcı şunu yaptı". İleride
 * "bu kullanıcı hangi karta yanıt veriyor, hangi eşikte umursuyor" sorusunun
 * cevabı buradan çıkacak ve bu kayıt GERİYE DÖNÜK ÜRETİLEMEZ — tutulmayan her
 * gün kalıcı kayıptır.
 *
 * İki kural:
 *
 *  1. GÖSTERİM DE YAZILIR, KARAR DA. Yalnız tıklananı kaydetmek "hangi kart
 *     görülüp umursanmadı" sorusunu ölçülemez kılardı — asıl sinyal odur.
 *  2. AYNI KART, AYNI ÖZNE, GÜNDE BİR SATIR. Pano her açılışta satır atsaydı
 *     gösterim sayısı ilgiyle karışır, yanıt oranı anlamsızlaşırdı. Tekillik
 *     veritabanında (`@@unique`), burada `skipDuplicates` ile sessizce geçilir.
 */

import { prisma } from "@/lib/db/prisma"
import { bugunBasi } from "@/lib/asistan/veri/temel"
import type { Kart, KartKarari } from "./tipler"

/**
 * Karar sonrası kartın susma süresi (gün).
 *
 * ACTED en uzun: kullanıcı siparişi verdi, mal gelene kadar stok düşük kalmaya
 * DEVAM eder ve kart her gün yeniden çıkarsa "seni dinledim, hâlâ bağırıyorsun"
 * etkisi doğar — kartlara güveni bitiren şey tam olarak budur.
 *
 * Karta göre değişmesi gerekiyorsa (K-STK-01'de tedarik süresi kadar susmak daha
 * doğru olurdu) burası koda göre dallanacak; şimdilik tek eşik yeter.
 */
const SUSTURMA_GUN: Record<KartKarari, number> = {
  ACTED: 7,
  DISMISSED: 3,
  SNOOZED: 1,
}

const gunSonra = (n: number) => new Date(Date.now() + n * 86_400_000)

/** Susturma süzgecinin anahtarı — kart kodu + özne. */
export const susturmaAnahtari = (kod: string, ozneId: string) => `${kod}|${ozneId}`

/**
 * Şu an susturulmuş kart+özne çiftleri.
 *
 * Kart üretimi bu kümeyle SÜZÜLÜR; süzme veritabanı sorgusunda yapılmaz çünkü
 * kartlar farklı kaynaklardan (stok, cari, nakit) geliyor ve her birine ayrı
 * "susturulmuşları çıkar" şartı yazmak kuralı dağıtırdı.
 */
export async function aktifSusturmalar(companyId: string): Promise<Set<string>> {
  const satirlar = await prisma.automationCardEvent.findMany({
    where: { companyId, snoozeUntil: { gt: new Date() } },
    select: { cardKey: true, subjectId: true },
  })
  return new Set(satirlar.map((s) => susturmaAnahtari(s.cardKey, s.subjectId)))
}

/**
 * Gösterilen kartları günlüğe yazar. Aynı gün ikinci kez yazılmaz.
 *
 * HATA YUTULUR — bilerek. Günlük yazımı başarısız olursa kullanıcı kartlarını
 * yine de görmeli; ölçüm uğruna asıl işlevi düşürmek yanlış takas olurdu.
 * Kaybedilen şey bir veri noktasıdır, kullanıcının panosu değil.
 */
export async function gosterimleriYaz(
  companyId: string,
  userId: string | null,
  kartlar: Kart[]
): Promise<void> {
  if (kartlar.length === 0) return

  try {
    await prisma.automationCardEvent.createMany({
      data: kartlar.map((k) => ({
        companyId,
        userId,
        cardKey: k.kod,
        cardVersion: k.surum,
        severity: k.onem.toUpperCase(),
        subjectType: k.ozneTuru,
        subjectId: k.ozneId,
        payload: k.olcum as object,
        shownDay: bugunBasi(),
      })),
      skipDuplicates: true,
    })
  } catch (e) {
    console.error("[otomasyon] gösterim günlüğü yazılamadı", e)
  }
}

export type KararGirdisi = {
  companyId: string
  userId: string | null
  kod: string
  ozneId: string
  karar: KartKarari
  /** Hangi butona basıldı — `Kart.aksiyonlar[].anahtar`. */
  aksiyon?: string | null
}

/**
 * Kullanıcının karar verdiği kartı işaretler.
 *
 * En son gösterim satırı güncellenir, BUGÜNKÜ satır değil: kart dün 23:50'de
 * gösterilip bugün 00:05'te tıklanırsa gün sınırı kararı düşürürdü.
 *
 * Karar verilmemiş satır bulunamazsa hiçbir şey yazılmaz (`false` döner) — kart
 * gösterilmeden karar gelemez, gelirse de uydurma bir satır açmak günlüğü
 * kirletirdi.
 */
export async function kararKaydet(g: KararGirdisi): Promise<boolean> {
  const son = await prisma.automationCardEvent.findFirst({
    where: {
      companyId: g.companyId,
      cardKey: g.kod,
      subjectId: g.ozneId,
      decision: null,
    },
    orderBy: { shownAt: "desc" },
    select: { id: true },
  })
  if (!son) return false

  await prisma.automationCardEvent.update({
    where: { id: son.id },
    data: {
      decision: g.karar,
      decidedAt: new Date(),
      actionKey: g.aksiyon ?? null,
      snoozeUntil: gunSonra(SUSTURMA_GUN[g.karar]),
      // userId gösterimde kaydedilmişti; karar veren başka biriyse onu yazalım.
      ...(g.userId ? { userId: g.userId } : {}),
    },
  })
  return true
}
