/**
 * Menü tarama — ORTAK tipler. İstemci de okur: burada sharp/unpdf/Prisma YOK.
 * Plan: docs/menu-tarama/PLAN.md (§3.3 şema, §3.4 kovalar, §3.9 hedefler).
 */

import type { Denetim, OkumaYolu } from "@/lib/belge-ocr/turler"

export type { Denetim, OkumaYolu }

/** Menüde yazan fiyat, KDV DAHİL. `etiket` sütun/varyant adı ("Küçük", "S", "Duble"), tek fiyatta null. */
export type MenuFiyat = { etiket: string | null; fiyat: number }

export type MenuKalem = {
  ad: string
  /** "espresso, süt, karamel" — ürüne YAZILMAZ (karar C), tarama kaydında kalır */
  aciklama: string | null
  /** Menüdeki bölüm başlığı → kategori adayı */
  bolum: string | null
  /** En az bir eleman; sırası menüdeki sıra (ucuzdan pahalıya değil) */
  fiyatlar: MenuFiyat[]
  /** Dosya içindeki sayfa (1 tabanlı) */
  sayfa: number
}

/** Tek SAYFANIN okuması — modelin döndüğü, normalize edilmiş biçim. */
export type MenuOkuma = {
  bolumler: string[]
  kalemler: MenuKalem[]
  /** Menü dibindeki not: "Fiyatlarımıza KDV dahildir" */
  kdvNotu: string | null
  /** Sayfada okunan para birimi (TRY/USD/EUR); okunamadıysa null */
  paraBirimi: string | null
  guven: { kalemler: number; fiyatlar: number; bolumler: number }
  /** Modelin başlık sanıp fiyatsız döndürdüğü satırlar — kalem sayılmaz, sayısı denetime yazılır */
  fiyatsizSatir: number
}

/** Oturum içi tekilleştirilmiş kalem: aynı ad iki sayfada geçerse teke iner. */
export type MenuKalemBirlesik = MenuKalem & {
  /** trFold(ad) — kova ve hedef anahtarı */
  anahtar: string
  /** Kalemin geçtiği dosya/sayfa(lar); ilk eleman hedef izinin yazılacağı satır */
  kaynaklar: Array<{ scanId: string; dosya: string; sayfa: number }>
  /** Aynı ad başka bir fiyatla da geçtiyse o fiyat kümeleri (ilk görülen kazanır) */
  cakisanFiyatlar: MenuFiyat[][]
}

export type FarkKovasi = "YENI" | "FIYAT_DEGISMIS" | "AYNI" | "MENUDE_YOK"

export const KOVA_ETIKETI: Record<FarkKovasi, string> = {
  YENI: "Yeni",
  FIYAT_DEGISMIS: "Fiyat değişmiş",
  AYNI: "Aynı",
  MENUDE_YOK: "Menüde yok",
}

/** Eşleştirmede kullanılan mevcut ürün özeti (Prisma satırından süzülür). */
export type MevcutUrun = {
  id: string
  name: string
  slug: string | null
  category: string | null
  /** Ürünün kendi oranı — mevcut üründe net çevrimi BUNUNLA yapılır (karar B) */
  vatRate: number
  /** NET satış fiyatı (DB'deki gibi); yoksa null */
  salePrice: number | null
  isSellable: boolean
  isService: boolean
  isActive: boolean
  /** Aktif reçetesi var mı — reçetesizlik uyarısı için */
  receteVar: boolean
  /** Mevcut seçenek grubu sayısı — çok fiyatlı satırda "grup zaten var" uyarısı */
  secenekGrubu: number
}

/** Çok fiyatlı satırdan türetilen seçenek grubu önerisi (karar A, §3.6). */
export type SecenekGrubuOnerisi = {
  /** "Boy" | "Servis" | "Seçenek" — etiket sözlüğünden türer */
  ad: string
  /** Etiketler sözlükte tanınmadıysa kullanıcı adları düzeltmeli */
  etiketTaninmadi: boolean
  secenekler: Array<{
    ad: string
    /** KDV DAHİL fark (ProductOption.priceDelta konvansiyonu) */
    priceDelta: number
    isDefault: boolean
  }>
}

/** Yeni ürün önerisi — kaydet düğmesi bu alanları gövdeye koyar. */
export type YeniUrunOnerisi = {
  kdvOrani: number
  /** KDV DAHİL taban fiyat (çok fiyatlıda en düşük) */
  brut: number
  /** brut'un `kdvOrani` ile net'i — DB'ye giden */
  net: number
  kategori: string | null
  secenekGrubu: SecenekGrubuOnerisi | null
}

export type FarkSatiri =
  | { kova: "YENI"; anahtar: string; kalem: MenuKalemBirlesik; oneri: YeniUrunOnerisi; denetimler: Denetim[] }
  | {
      kova: "FIYAT_DEGISMIS"
      anahtar: string
      kalem: MenuKalemBirlesik
      urun: MevcutUrun
      /** Ürünün bugünkü KDV DAHİL fiyatı (net × oran); fiyatı yoksa null */
      eskiBrut: number | null
      yeniBrut: number
      /** Ürünün KENDİ oranı — oturum oranı DEĞİL */
      kdvOrani: number
      yeniNet: number
      denetimler: Denetim[]
    }
  | { kova: "AYNI"; anahtar: string; kalem: MenuKalemBirlesik; urun: MevcutUrun; denetimler: Denetim[] }
  | { kova: "MENUDE_YOK"; anahtar: string; urun: MevcutUrun; denetimler: Denetim[] }

/** Hedef izi — oturumun BAŞ satırındaki `targets` dizisinin elemanı. */
export type MenuHedefTuru = "PRODUCT" | "OPTION_GROUP" | "PRICE" | "UNLISTED"

export type MenuHedefi = {
  /** Fark satırının anahtarı (trFold(ad); menüde-yok için "urun:<id>") */
  anahtar: string
  type: MenuHedefTuru
  /** Ürün id'si (OPTION_GROUP'ta grup id'si) */
  id: string
  /** Ürün adı — kutuda ve geri almada gösterilir */
  no: string | null
  at: string
  /** Geri alındıysa ne yapıldı (§3.13) */
  geriAlma?: { at: string; sonuc: "silindi" | "menuden-kaldirildi" | "geri-acildi" | "dokunulmadi" }
}

export const MENU_HEDEF_ETIKETI: Record<MenuHedefTuru, string> = {
  PRODUCT: "Ürün oluşturuldu",
  OPTION_GROUP: "Seçenek grubu",
  PRICE: "Fiyat güncellendi",
  UNLISTED: "Menüden kaldırıldı",
}

/** Oturum özeti — gelen kutusu satırı (dosyalar tek oturumda toplanır). */
export type MenuOturumOzeti = {
  sessionId: string
  status: "READING" | "AWAITING_APPROVAL" | "SAVED" | "REJECTED" | "FAILED"
  dosyalar: Array<{ id: string; fileName: string; status: string; error: string | null; pageCount: number }>
  sayfa: number
  kalem: number
  tamMenu: boolean
  hedef: number
  costUsd: number | null
  createdAt: string
  updatedAt: string
}

/** Oturum detayı — `GET /api/restoran/menu-tarama/oturum/[sessionId]` yanıtı. */
export type MenuOturumDetayi = {
  sessionId: string
  status: MenuOturumOzeti["status"]
  dosyalar: Array<{ id: string; fileName: string; status: string; error: string | null; pageCount: number; costUsd: number | null }>
  /** Fark listesinin kurulduğu oturum oranı (sorgu paramı ya da yükleme anındaki) */
  oturumKdv: number
  tamMenu: boolean
  menuyeBenziyor: boolean
  bolumler: string[]
  kalemler: MenuKalemBirlesik[]
  denetimler: Denetim[]
  fark: FarkSatiri[]
  kovalar: Record<FarkKovasi, number>
  hedefler: MenuHedefi[]
  createdAt: string
}
