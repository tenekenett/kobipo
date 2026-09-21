/**
 * Menü kalemleri × mevcut ürünler → FARK LİSTESİ (plan §3.4, §3.8). Saf.
 *
 * Eşleştirme kuralı Excel içe aktarımla AYNI (`lib/import/rows.ts` → `pickMatch`,
 * anahtar `trFold`): iki yol "aynı ürün mü" sorusuna farklı cevap verirse aynı
 * kafede iki kart açılır. Menüde kod/barkod yoktur, tek kural AD.
 *
 * KDV (karar B): YENİ üründe oturum oranı (alkol sözlüğü %20 önerir), MEVCUT
 * üründe ürünün KENDİ oranı — zam menüsü ürünün KDV oranını değiştirmez.
 */

import { pickMatch } from "@/lib/import/rows"
import { brutFiyat, kdvOnerisi, netFiyat, secenekGrubuTuret, tabanBrut } from "./fiyat"
import { kalemDenetle, medyanTabanFiyat } from "./validate"
import type { Denetim, FarkSatiri, MenuKalemBirlesik, MevcutUrun } from "./turler"

export type FarkAyari = {
  oturumKdv: number
  /** "Bu yüklenenler menünün TAMAMI" işaretliyse menüde olmayan ürünler listelenir */
  tamMenu: boolean
}

const RECETE_YOK: Denetim = {
  anahtar: "recete",
  etiket: "Reçete",
  durum: "olcelemedi",
  aciklama: "Reçetesi yok: satışta stoktan düşmez. Menü & Reçeteler ekranından kurabilirsiniz.",
}

export function farkListesiKur(kalemler: MenuKalemBirlesik[], urunler: MevcutUrun[], ayar: FarkAyari): FarkSatiri[] {
  const medyan = medyanTabanFiyat(kalemler)
  const eslesen = new Set<string>()
  const satirlar: FarkSatiri[] = []

  for (const kalem of kalemler) {
    const denetimler = kalemDenetle(kalem, medyan)
    const brut = tabanBrut(kalem.fiyatlar)
    const sonuc = pickMatch(urunler, [{ by: "ad", value: kalem.ad, of: (u) => u.name }])

    if (sonuc.status === "new" || sonuc.status === "conflict") {
      // Tek kural (ad) olduğu için conflict çıkmaz; çıkarsa yeni ürün sayılır ve
      // POST'un ad denetimi 409 ile durdurur — sessiz mükerrer doğmaz.
      const kdvOrani = kdvOnerisi(kalem.bolum, kalem.ad, ayar.oturumKdv)
      satirlar.push({
        kova: "YENI",
        anahtar: kalem.anahtar,
        kalem,
        oneri: {
          kdvOrani,
          brut,
          net: netFiyat(brut, kdvOrani),
          kategori: kalem.bolum,
          secenekGrubu: secenekGrubuTuret(kalem.fiyatlar),
        },
        denetimler: [...denetimler, RECETE_YOK],
      })
      continue
    }

    const urun = sonuc.record
    eslesen.add(urun.id)
    const ekDenetim: Denetim[] = []
    if (!urun.isActive) ekDenetim.push({ anahtar: "pasif", etiket: "Pasif ürün", durum: "patladi", aciklama: "Ürün pasif; menüye dönmesi için ürün kartından aktif edilmeli" })
    if (!urun.isSellable) ekDenetim.push({ anahtar: "gizli", etiket: "Menüde gizli", durum: "olcelemedi", aciklama: "Ürün satış ekranında gizli (isSellable=false); fiyat güncellenir ama görünmez" })
    if (!urun.receteVar && !urun.isService) ekDenetim.push(RECETE_YOK)
    if (kalem.fiyatlar.length > 1) {
      ekDenetim.push({
        anahtar: "varyant",
        etiket: "Boy fiyatları",
        durum: "olcelemedi",
        aciklama: urun.secenekGrubu > 0
          ? "Çok fiyatlı satır: yalnız taban fiyat karşılaştırılır, mevcut seçenek farkları güncellenmez"
          : "Çok fiyatlı satır ama üründe seçenek grubu yok; taban fiyat karşılaştırılır, grubu Menü & Reçeteler'den kurun",
      })
    }

    const eskiBrut = urun.salePrice == null ? null : brutFiyat(urun.salePrice, urun.vatRate)
    const ayni = eskiBrut != null && Math.abs(eskiBrut - brut) < 0.005
    if (ayni) {
      satirlar.push({ kova: "AYNI", anahtar: kalem.anahtar, kalem, urun, denetimler: [...denetimler, ...ekDenetim] })
    } else {
      satirlar.push({
        kova: "FIYAT_DEGISMIS",
        anahtar: kalem.anahtar,
        kalem,
        urun,
        eskiBrut,
        yeniBrut: brut,
        kdvOrani: urun.vatRate,
        yeniNet: netFiyat(brut, urun.vatRate),
        denetimler: [...denetimler, ...ekDenetim],
      })
    }
  }

  if (ayar.tamMenu) {
    for (const urun of urunler) {
      if (eslesen.has(urun.id)) continue
      // Satış ızgarasında görünen ürünler: hizmetler zaten iki satış ekranında da yok.
      if (!urun.isSellable || !urun.isActive || urun.isService) continue
      satirlar.push({ kova: "MENUDE_YOK", anahtar: `urun:${urun.id}`, urun, denetimler: [] })
    }
  }

  return satirlar
}

export function kovaSay(satirlar: FarkSatiri[]): Record<FarkSatiri["kova"], number> {
  const s = { YENI: 0, FIYAT_DEGISMIS: 0, AYNI: 0, MENUDE_YOK: 0 }
  for (const r of satirlar) s[r.kova]++
  return s
}
