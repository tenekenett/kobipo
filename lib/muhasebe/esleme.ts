/**
 * TOPLU EŞLEME — "Gözden geçir"de bekleyen taslak satırları "bu tedarikçi / bu satır türü"
 * gruplarına toplar; kullanıcı her gruba bir hesap seçer, grup tek seferde eşlenir.
 * Saf modül (Prisma yok), testli. Okuma/yazma `esleme.server.ts`te.
 *
 * Grup = satırın ÖĞRENME ANAHTARLARI (+ rolü). Anahtar, satır onaylanınca neyin
 * öğrenileceğidir (`fis-kurallari.ts`, `para-kurallari.ts`): "alis:cari-kdv:<tedarikçi>:20"
 * o tedarikçinin %20'lik ürünsüz alışları, "gider:kategori:kira" faturasız kira gideri.
 * Aynı anahtarlı satırlar onayda AYNI kurala yazılacağı için tek kararla eşlenebilir.
 *
 * Eşleme satırı ELLE SEÇİLMİŞ (USER) yapar, kural YAZMAZ: öğrenme yalnız ONAYDA olur
 * (CLAUDE.md, muhasebe). Eşlenen fiş "emin"e geçer; onaylanınca kural öğrenilir ve sonraki
 * belgeler kendiliğinden o hesaba düşer.
 */

import { ALT_ROLLERI, TAHMIN_ROLLERI, type SatirRolu } from "@/lib/muhasebe/fis"

/**
 * Eşleme dışı roller: alt hesap satırı (cari/kasa/personel — kaydın kendi hesabıdır;
 * hesapsızsa plan kurulmamıştır), elle satır ve açılış farkı (fişin kendisinde dağıtılır).
 */
const ESLEME_DISI: ReadonlySet<string> = new Set<string>([...ALT_ROLLERI, "MANUEL", "ACILIS_FARK"])

export type BekleyenSatir = {
  id: string
  voucherId: string
  role: string
  side: string
  amount: number
  learnKeys: string[]
  suggestedCode: string
  description: string | null
  accountId: string | null
  accountSource: string
}

/** Satır fişi "gözden geçir"de tutuyor ve toplu eşlenebilir mi. */
export function eslemeBekliyorMu(s: Pick<BekleyenSatir, "role" | "accountId" | "accountSource">): boolean {
  if (ESLEME_DISI.has(s.role)) return false
  if (!s.accountId) return true
  return s.accountSource === "DEFAULT" && TAHMIN_ROLLERI.has(s.role as SatirRolu)
}

/**
 * Grup anahtarı. Öğrenme anahtarı olan satır anahtarlarıyla gruplanır (sıra önemsiz);
 * anahtarsız satır (ör. tek taraflı virmanın karşı satırı) rol + önerilen kod + açıklamayla.
 */
export function eslemeAnahtari(s: Pick<BekleyenSatir, "role" | "learnKeys" | "suggestedCode" | "description">): string {
  if (s.learnKeys.length > 0) return `${s.role}|${[...s.learnKeys].sort().join(",")}`
  return `${s.role}|∅|${s.suggestedCode}|${s.description ?? ""}`
}

export type EslemeGrubu = {
  anahtar: string
  rol: string
  ogrenmeAnahtarlari: string[]
  oneriKodu: string
  /** Satırların en sık açıklaması (kategori adı, "Gider / hizmet alışı" …). */
  aciklama: string
  taraf: "B" | "A" | "karisik"
  satirSayisi: number
  fisSayisi: number
  tutar: number
  /** Şu an tahmin olarak yazılmış hesap (varsayılan) — yoksa satır hesapsız. */
  tahminHesapId: string | null
  ornekFisler: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function eslemeGruplari(satirlar: BekleyenSatir[]): EslemeGrubu[] {
  const gruplar = new Map<
    string,
    EslemeGrubu & { fisler: Set<string>; aciklamalar: Map<string, number>; taraflar: Set<string>; tahminler: Set<string | null> }
  >()
  for (const s of satirlar) {
    if (!eslemeBekliyorMu(s)) continue
    const anahtar = eslemeAnahtari(s)
    let g = gruplar.get(anahtar)
    if (!g) {
      g = {
        anahtar,
        rol: s.role,
        ogrenmeAnahtarlari: [...s.learnKeys].sort(),
        oneriKodu: s.suggestedCode,
        aciklama: "",
        taraf: "B",
        satirSayisi: 0,
        fisSayisi: 0,
        tutar: 0,
        tahminHesapId: null,
        ornekFisler: [],
        fisler: new Set(),
        aciklamalar: new Map(),
        taraflar: new Set(),
        tahminler: new Set(),
      }
      gruplar.set(anahtar, g)
    }
    g.satirSayisi++
    g.tutar += s.amount
    g.fisler.add(s.voucherId)
    g.taraflar.add(s.side)
    g.tahminler.add(s.accountId)
    const ac = s.description ?? ""
    g.aciklamalar.set(ac, (g.aciklamalar.get(ac) ?? 0) + 1)
  }
  return [...gruplar.values()]
    .map(({ fisler, aciklamalar, taraflar, tahminler, ...g }) => ({
      ...g,
      tutar: r2(g.tutar),
      fisSayisi: fisler.size,
      ornekFisler: [...fisler].slice(0, 5),
      aciklama: [...aciklamalar.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      taraf: taraflar.size > 1 ? ("karisik" as const) : taraflar.has("CREDIT") ? ("A" as const) : ("B" as const),
      // Grupta tek bir tahmin hesabı varsa gösterilir; karışıksa (bazısı hesapsız) gösterilmez.
      tahminHesapId: tahminler.size === 1 ? [...tahminler][0] : null,
    }))
    .sort((a, b) => b.fisSayisi - a.fisSayisi || b.tutar - a.tutar || a.anahtar.localeCompare(b.anahtar))
}

/** Satır rolünün kullanıcıya görünen adı (eşleme ekranındaki "ne için" sütunu). */
export const ESLEME_ROL_ADI: Readonly<Record<string, string>> = {
  ALIS: "Alış (gider / maliyet)",
  GIDER: "Faturasız gider",
  GELIR: "Faturasız gelir",
  KARSI: "Karşı hesap",
  BAKIYE_KAPAMA: "Bakiye kapama / iskonto",
  BORDRO_GIDER: "Bordro gideri",
  BORDRO_SGK: "Bordro SGK",
  BORDRO_VERGI: "Bordro vergisi",
  BORDRO_DIGER: "Bordro diğer kesinti",
  BORDRO_AVANS: "Bordro avans",
  SATIS: "Satış geliri",
  SATIS_IADE: "Satıştan iade",
  KDV_HESAPLANAN: "Hesaplanan KDV",
  KDV_INDIRILECEK: "İndirilecek KDV",
  TEVKIFAT: "Tevkifat",
  OTV: "ÖTV",
  DIGER_VERGI: "Diğer vergi",
  YUVARLAMA: "Yuvarlama farkı",
  KIYMET: "Çek / senet",
  ACILIS: "Açılış bakiyesi",
}

/** Öğrenme anahtarının ne olduğu — etiket için çözülür. */
export type AnahtarTuru =
  | { tur: "tedarikci-kdv"; tedarikciId: string; oran: string }
  | { tur: "urun"; yon: "alis" | "satis" | "satis-iade"; urunId: string }
  | { tur: "kategori"; yon: "gelir" | "gider"; kategori: string }
  | { tur: "sabit"; etiket: string }

const SABIT: Readonly<Record<string, string>> = {
  "bordro:gider": "Bordro gideri (brüt ücretler)",
  "bordro:isveren-sgk": "SGK işveren payı (bordro)",
  "bakiye-kapama:verilen": "Verilen iskonto / bakiye kapama",
  "bakiye-kapama:alinan": "Alınan iskonto / bakiye kapama",
  "acilis:cari": "Cari açılış bakiyelerinin karşılığı",
  "acilis:kasa": "Kasa / banka açılış bakiyelerinin karşılığı",
  "satis:otv": "Satış ÖTV'si",
  "satis:diger-vergi": "Satıştaki diğer vergiler",
  "alis:tevkifat": "Alışta tevkif edilen KDV",
}

export function anahtarTuru(anahtar: string): AnahtarTuru | null {
  const sabit = SABIT[anahtar]
  if (sabit) return { tur: "sabit", etiket: sabit }
  const p = anahtar.split(":")
  if (p[0] === "alis" && p[1] === "cari-kdv" && p.length === 4) return { tur: "tedarikci-kdv", tedarikciId: p[2], oran: p[3] }
  if ((p[0] === "alis" || p[0] === "satis" || p[0] === "satis-iade") && p[1] === "urun" && p.length === 3) {
    return { tur: "urun", yon: p[0], urunId: p[2] }
  }
  if ((p[0] === "gelir" || p[0] === "gider") && p[1] === "kategori") {
    return { tur: "kategori", yon: p[0], kategori: p.slice(2).join(":") }
  }
  if (p[0] === "alis" && p[1] === "kdv" && p.length === 3) return { tur: "sabit", etiket: `İndirilecek KDV %${p[2]}` }
  if (p[0] === "satis" && p[1] === "kdv" && p.length === 3) return { tur: "sabit", etiket: `Hesaplanan KDV %${p[2]}` }
  return null
}

/**
 * Grubun okunur adı. Ürün ve tedarikçi adları dışarıdan verilir (bulunamazsa "silinmiş").
 * Birden çok anahtarlı grup (aynı satıra birleşmiş birkaç ürün) adlarını sıralar.
 */
export function grupEtiketi(
  g: Pick<EslemeGrubu, "ogrenmeAnahtarlari" | "aciklama" | "rol">,
  adlar: { tedarikci: ReadonlyMap<string, string>; urun: ReadonlyMap<string, string> },
): string {
  if (g.ogrenmeAnahtarlari.length === 0) return g.aciklama || g.rol
  const parcalar = g.ogrenmeAnahtarlari.map((a) => {
    const t = anahtarTuru(a)
    if (!t) return a
    switch (t.tur) {
      case "sabit":
        return t.etiket
      case "tedarikci-kdv":
        return `${adlar.tedarikci.get(t.tedarikciId) ?? "Silinmiş tedarikçi"} · KDV %${t.oran} alışları`
      case "urun": {
        const ad = adlar.urun.get(t.urunId) ?? "Silinmiş ürün"
        return t.yon === "alis" ? `${ad} (alış)` : t.yon === "satis" ? `${ad} (satış)` : `${ad} (satış iadesi)`
      }
      case "kategori":
        // Anahtardaki kategori küçük harfe katlanmıştır; okunur adı satırın açıklamasındadır.
        // Kategorisiz hareketin anahtarı "-" (para-kurallari.ts → anahtarParcasi).
        return `${t.yon === "gider" ? "Faturasız gider" : "Faturasız gelir"} · ${t.kategori === "-" ? "kategorisiz" : g.aciklama || t.kategori}`
    }
  })
  const tekil = [...new Set(parcalar)]
  return tekil.length <= 3 ? tekil.join(", ") : `${tekil.slice(0, 3).join(", ")} +${tekil.length - 3}`
}
