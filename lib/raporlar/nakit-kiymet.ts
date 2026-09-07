/**
 * ÇEK/SENET → NAKİT PROJEKSİYONU KALEMİ. Saf modül, Prisma yok.
 *
 * ── Neden gerekti: para eğriden BÜSBÜTÜN kayboluyordu ───────────────────────
 * Projeksiyon kalemlerini cari yaşlandırmadan alıyor (`nakit-projeksiyon.ts`),
 * yaşlandırma ise çek/senedi `getCheckNoteCreditMap` ile cari kredisi sayıyor:
 * müşteri 100.000 TL'lik çek verdiğinde faturanın açık tutarı SIFIRLANIYOR.
 * Fatura eğriden düşüyor, çekin kendisi de hiç eklenmediği için 30 gün sonra
 * gelecek para tabloda hiçbir yerde görünmüyordu.
 *
 * ÖLÇÜM (2026-09-06, canlı): ileri vadeli portföy çeki/senedi 3 firmada var —
 * 1.167.000 TL giriş, 200.000 TL çıkış. Aynı firmalarda açık faturaların vadesi
 * ya yazılmamış (`Invoice.dueDate` en büyük firmada %0) ya da türetilen vade
 * çoktan geçmiş. Yani bu evraklar eğrinin ileri tarafındaki TEK gerçek kalem;
 * eklenmedikleri sürece "önümüzdeki 12 hafta" sorusu boş dönüyor.
 *
 * ── Neden ÇİFTE SAYIM değil ─────────────────────────────────────────────────
 * Kredi haritası evrakı zaten cariden düşmüş durumda; burada eklenen tutar aynı
 * parayı ikinci kez saymaz, yalnız DOĞRU TARİHE taşır: "bugün kapanmış alacak"
 * yerine "14 Eylül'de gelecek nakit". Faturaya bağlı olmayan (cari kartı boş)
 * evrak da aynı kalemle girer — o zaten hiçbir yerde netleşmemişti.
 *
 * ── Yalnız PORTFÖYDE ────────────────────────────────────────────────────────
 * CİRO_EDİLDİ evrak bize gelmez (başkasına devredildi), TAHSİL_EDİLDİ zaten
 * kasaya girdi ve açılış bakiyesinde. İADE_EDİLDİ/PROTESTOLU tahsil edilemedi.
 * Dördü de eğriye girerse projeksiyon olmayacak parayı bekler.
 *
 * ── Yalnız VADESİ GELMEMİŞ olan ─────────────────────────────────────────────
 * Vadesi geçtiği hâlde portföyde duran evrak bir KAYIT BOŞLUĞUDUR, planlanmış
 * bir nakit hareketi değil: ya tahsil edildi ve düşülmedi, ya karşılıksız çıktı
 * (K-NKT-06 kartının konusu tam olarak bu). Bunları "vadesi geçmiş giriş"
 * sütununa yazmak iki ayrı sorunu — tahsil edilemeyen alacağı ve kaydı
 * düşülmemiş evrakı — tek rakamda toplardı. Canlı veri bunu ayrıca zorluyor:
 * bir firmada 3.213.123.123.123 TL tutarlı, vadesi geçmiş bir portföy çeki var;
 * toplama girse o firmanın nakit raporu tek satırda okunamaz hâle gelirdi.
 */

import { resolveCekSenetDirection } from "@/lib/cek-senet/labels"
import type { ProjectionItem } from "./nakit-projeksiyon-kova"

/** Eğriye giren tek durum. */
export const PROJEKSIYONA_GIREN_DURUM = "PORTFÖYDE"

/** Çek ve senedin projeksiyon için ortak alanları. */
export type KiymetKaydi = {
  amount: unknown
  dueDate: Date | string
  direction: string | null
  /** Yön çözümü için: `direction` null olan eski kayıtlarda tedarikçi = verilen. */
  supplierId: string | null
}

/**
 * Portföydeki ileri vadeli çek/senetleri projeksiyon kalemine çevirir.
 *
 * `today` günün BAŞI olarak verilir; vadesi bugün olan evrak eğriye girer
 * (bugün tahsil edilecek), dünkü girmez.
 */
export function kiymetleriKalemeCevir(
  kayitlar: KiymetKaydi[],
  today: Date
): ProjectionItem[] {
  const gunBasi = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const kalemler: ProjectionItem[] = []

  for (const kayit of kayitlar) {
    const tutar = Number(kayit.amount)
    // Tutarsız/bozuk kayıt eğriyi sessizce kaydırmasın.
    if (!Number.isFinite(tutar) || tutar <= 0) continue

    const vade = new Date(kayit.dueDate)
    if (Number.isNaN(vade.getTime())) continue
    const vadeGunu = new Date(vade.getFullYear(), vade.getMonth(), vade.getDate()).getTime()
    if (vadeGunu < gunBasi) continue

    kalemler.push({
      dueDate: vade,
      amount: tutar,
      // Alınan evrak para GİRİŞİ, verilen evrak ÇIKIŞ. Yön çözümü tek kaynaktan
      // (`resolveCekSenetDirection`) geliyor: portföy ekranı, makbuz ve bu rapor
      // aynı çeke "alınan" demeli.
      direction: resolveCekSenetDirection(kayit) === "RECEIVED" ? "in" : "out",
      // Çek/senette vade ZORUNLU alan (şema: `dueDate DateTime`), tahmin edilmiş
      // değil. Faturadan farkı bu: burada "vadesi bilinmiyor" hâli yok.
      hasDueDate: true,
    })
  }

  return kalemler
}
