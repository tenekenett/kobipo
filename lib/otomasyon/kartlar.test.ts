// Otomasyon kartlarının NÖBETÇİSİ — `page-api-coverage` ve
// `write-guard-coverage` ile aynı fikir: sözleşmeyi elle değil mekanik koru.
//
// İki hata bu dosya yokken ELLE yakalandı (2026-09-06) ve ikisi de sessizdi:
//
//   1. K-BLG-04'ün aksiyonu `/faturalar`a gidiyordu. O bir MENÜ ANAHTARI, sayfa
//      değil — altında yalnız [id] rotaları var, index yok. Buton 404 açardı.
//   2. Aynı kartın KAPISI da `/faturalar`dı. Yanlış kapı daha beter: kart hiç
//      görünmez, üstelik hata da vermez.
//
// Kart sayısı 60'a çıkarken ikisinin de tekrarlanmaması için ölçüm burada durur.

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { kartSirasi, type Kart, type KartOnem } from "./tipler"
import { NAV_PAGES } from "../nav/pages"
import { MODULE_KEYS } from "../modules"

const ROOT = process.cwd()
const KAYIT_DEFTERI = "lib/otomasyon/kartlar.ts"
const SAYFA_KOKU = "app/(dashboard)"

const kaynak = fs.readFileSync(path.resolve(ROOT, KAYIT_DEFTERI), "utf8")

/**
 * KAYIT DEFTERİNDEKİ kodlar — kart üreticilerindeki değil.
 *
 * `kod: "K-STK-01"` iki yerde geçiyor: TANIMLAR girdisinde ve o kartı kuran
 * fonksiyonun döndürdüğü nesnede. İkisini birden toplamak her kodu "iki kez
 * kullanılmış" gösterirdi; bu yüzden yalnız TANIMLAR bloğu okunur.
 */
function tanimlarBlogu(): string {
  const bas = kaynak.indexOf("const TANIMLAR")
  const son = kaynak.indexOf("\n]", bas)
  return kaynak.slice(bas, son)
}

function kodlar(): string[] {
  return [...tanimlarBlogu().matchAll(/kod: "([^"]+)"/g)].map((m) => m[1])
}

/** `kapi: { modul: "x", sayfa: "/y" }` üçlüleri. */
function kapilar(): Array<{ modul?: string; sayfa?: string }> {
  return [...tanimlarBlogu().matchAll(/kapi: \{([^}]*)\}/g)].map((m) => ({
    modul: /modul: "([^"]+)"/.exec(m[1])?.[1],
    sayfa: /sayfa: "([^"]+)"/.exec(m[1])?.[1],
  }))
}

/** Karttaki bütün `href` değerleri — ham hâlleriyle, sorgu dizesi dahil. */
function hamHrefler(): string[] {
  return [
    ...new Set(
      [...kaynak.matchAll(/href: (`[^`]+`|"[^"]+")/g)].map((m) =>
        m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, "SEGMENT")
      )
    ),
  ]
}

/**
 * Karttaki bütün `href` değerleri.
 *
 * Şablon dizeleri de alınır (`/stok/${slug}`); değişken parçalar tek bir
 * segmentlik yer tutucuya indirgenir, çünkü rota eşlemesinde önemli olan
 * segment SAYISI ve dinamik olup olmadığıdır, değerin kendisi değil.
 */
function hrefler(): string[] {
  return [...new Set(hamHrefler().map((h) => h.split("?")[0]))]
}

/**
 * Bir rotanın sayfa dosyası + BİR SEVİYE altındaki yerel bileşenleri.
 *
 * Tek dosyaya bakmak yetmiyor: `/satis/fatura/page.tsx` on üç satır ve bütün işi
 * `FaturalarListing`e devrediyor; param'ı okuyan da o. Bir seviye izlemek, bugün
 * kartların bastığı üç hedefin üçünü de kapsıyor.
 */
function hedefKaynagi(href: string): string {
  const yol = path.resolve(ROOT, SAYFA_KOKU, `.${href}`, "page.tsx")
  if (!fs.existsSync(yol)) return ""
  const sayfa = fs.readFileSync(yol, "utf8")
  const yerel = [...sayfa.matchAll(/from "@\/((?:components|lib)\/[^"]+)"/g)].map((m) => m[1])
  return (
    sayfa +
    yerel
      .flatMap((rel) => [`${rel}.tsx`, `${rel}.ts`])
      .filter((p) => fs.existsSync(path.resolve(ROOT, p)))
      .map((p) => fs.readFileSync(path.resolve(ROOT, p), "utf8"))
      .join("\n")
  )
}

/** app/(dashboard) altındaki tüm sayfa rotaları, `/a/[id]/b` biçiminde. */
function rotalar(): string[] {
  const kok = path.resolve(ROOT, SAYFA_KOKU)
  const cikti: string[] = []
  const gez = (dizin: string, yol: string) => {
    for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
      if (girdi.isDirectory()) {
        // (grup) klasörleri URL'e girmez.
        const parca = girdi.name.startsWith("(") ? "" : `/${girdi.name}`
        gez(path.join(dizin, girdi.name), yol + parca)
      } else if (girdi.name === "page.tsx") {
        cikti.push(yol || "/")
      }
    }
  }
  gez(kok, "")
  return cikti
}

/** Rota kalıbı bu href'i karşılıyor mu? Dinamik segment her şeye uyar. */
function eslesir(rota: string, href: string): boolean {
  const r = rota.split("/").filter(Boolean)
  const h = href.split("/").filter(Boolean)
  if (r.length !== h.length) return false
  return r.every((parca, i) => (parca.startsWith("[") ? true : parca === h[i]))
}

/**
 * YALNIZ birincil aksiyonların href'leri.
 *
 * Ayrım anlamlı: birincil aksiyon "kartın saydığı kayıtları aç" demektir,
 * ikincil linkler ise "şuraya da bakabilirsin" kısayoludur. Pencere kuralı
 * (aşağıda) yalnız birincisi için geçerli — ikincil "Alış faturaları"
 * kısayoluna pencere dayatmak, kartın hiç saymadığı bir listeyi daraltmak olurdu.
 *
 * Şablon ifadeleri (`${...}`) önce yer tutucuya indirgeniyor; aksi hâlde
 * ifadenin içindeki `}` nesne sınırıyla karışırdı.
 */
function birincilHrefler(): string[] {
  const duz = kaynak.replace(/\$\{[^}]*\}/g, "SEGMENT")
  return [
    ...new Set(
      [...duz.matchAll(/href: (`[^`]+`|"[^"]+")[^}]*?birincil: true/g)].map((m) =>
        m[1].slice(1, -1)
      )
    ),
  ]
}

describe("otomasyon kartları", () => {
  it("kod biçimi doğru ve benzersiz", () => {
    const hepsi = kodlar()
    expect(hepsi.length, "kayıt defterinde hiç kart bulunamadı").toBeGreaterThan(0)

    const bozuk = hepsi.filter((k) => !/^K-[A-Z]{3}-\d{2}$/.test(k))
    expect(bozuk, `Kod şeması K-<ALAN>-<NN> olmalı:\n${bozuk.join("\n")}`).toEqual([])

    const tekrar = hepsi.filter((k, i) => hepsi.indexOf(k) !== i)
    expect(
      tekrar,
      `Aynı kod iki kez kullanılmış — günlükteki geçmişi bozar:\n${tekrar.join("\n")}`
    ).toEqual([])
  })

  it("her kartın kapısı gerçek bir modül ve menü sayfasıdır", () => {
    const menu = new Set(NAV_PAGES.map((p) => p.href))
    const moduller = new Set(MODULE_KEYS)
    const hatalar: string[] = []

    for (const kapi of kapilar()) {
      if (kapi.modul && !moduller.has(kapi.modul)) {
        hatalar.push(`modül yok: ${kapi.modul}`)
      }
      if (kapi.sayfa && !menu.has(kapi.sayfa)) {
        hatalar.push(`menü sayfası yok: ${kapi.sayfa}`)
      }
    }

    expect(
      hatalar,
      "Kapı yanlışsa kart SESSİZCE hiç görünmez — hata bile vermez:\n" + hatalar.join("\n")
    ).toEqual([])
  })

  it("her aksiyon linki gerçek bir sayfaya çıkar", () => {
    const tumRotalar = rotalar()
    const kirik = hrefler().filter((h) => !tumRotalar.some((r) => eslesir(r, h)))
    expect(
      kirik,
      `Şu linklerin karşılığında sayfa yok — kart tıklanınca 404 açar:\n${kirik.join("\n")}`
    ).toEqual([])
  })

  /**
   * Hedef ekranın TARİH PENCERESİ varsa, kart onu ele almak ZORUNDA.
   *
   * 2026-09-07'de tarayıcıda yakalandı ve dördüncü kural bunu göremedi: K-BLG-09
   * "6 fatura takılmış, en eskisi 117 gün" diyordu, linki `?durum=SENT`
   * taşıyordu — param okunuyordu, kural geçiyordu. Ama ekranın varsayılan
   * penceresi 90 gün: liste 55 satır gösterdi ve kartın saydığı belgelerin
   * dördü orada HİÇ YOKTU.
   *
   * Kural iki koşula birden bakar: link SÜZGEÇ taşıyorsa (sorgu dizesi varsa)
   * ve hedef sayfa `gun` okuyorsa, `gun=` de taşımalı. Süzgeçli link "işte
   * saydığım kayıtlar" demektir; SÜZGEÇSİZ link ise yalnız yön tarifidir
   * (K-STK-09'un "alış faturası gir" düğmesi gibi — o kart ürün sayar, fatura
   * değil) ve pencere dayatmak orada yanlış olurdu.
   *
   * Pencereyi kartın kendi en eski kaydından türetmek kartın işi; test yalnız
   * "pencereyi hiç düşünmemiş" hâli yakalar — bugün kaybettiğimiz tam olarak oydu.
   */
  it("tarih penceresi olan ekrana giden BİRİNCİL link pencereyi taşıyor", () => {
    const hatalar: string[] = []

    for (const href of birincilHrefler()) {
      const [yol, sorgu] = href.split("?")
      // Süzgeçsiz link "işte saydığım kayıtlar" iddiası taşımaz.
      if (!sorgu) continue
      const kaynakMetni = hedefKaynagi(yol)
      // Sayfa gün penceresi okumuyorsa kuralın konusu değil.
      if (!kaynakMetni.includes('get("gun")')) continue
      if (!/(^|&)gun=/.test(sorgu)) {
        hatalar.push(
          `${yol}: süzgeçli birincil link, ekranın "gun" penceresini taşımıyor` +
            ` (?${sorgu})`
        )
      }
    }

    expect(
      hatalar,
      "Pencere taşımayan link, kartın saydığı eski kayıtları EKRANDA GÖSTERMEZ:\n" +
        hatalar.join("\n")
    ).toEqual([])
  })

  /**
   * Linkteki her param'ı hedef ekran GERÇEKTEN okumalı.
   *
   * Okumayan bir param sessizdir — en beteri de bu: buton doğru sayfayı açar,
   * sayfa kendi varsayılanıyla gelir ve kart "517 fatura" derken liste sıfır
   * satır gösterir. 2026-09-06'da tarayıcıda tam olarak bu yaşandı; param'lar
   * yazılmıştı, ekran okumuyordu.
   */
  it("aksiyon linkindeki her param'ı hedef ekran okuyor", () => {
    const hatalar: string[] = []

    for (const href of hamHrefler()) {
      const [yol, sorgu] = href.split("?")
      if (!sorgu) continue
      const kaynakMetni = hedefKaynagi(yol)
      if (!kaynakMetni) {
        hatalar.push(`${yol}: sayfa dosyası bulunamadı`)
        continue
      }
      for (const parca of sorgu.split("&")) {
        const ad = parca.split("=")[0]
        // `company` her panel linkinde var ve CompanyLink/URL katmanı okur.
        if (!ad || ad === "company") continue
        if (!kaynakMetni.includes(`get("${ad}")`)) {
          hatalar.push(`${yol}: "${ad}" param'ı gönderiliyor ama ekran okumuyor`)
        }
      }
    }

    expect(
      hatalar,
      "Okunmayan param SESSİZDİR: sayfa açılır, kartın saydığı kayıtlar görünmez.\n" +
        hatalar.join("\n")
    ).toEqual([])
  })
})

/**
 * Sıralama kuralı — panonun üç kartlık bütçesinde kimin görüneceğini bu belirler.
 *
 * `kartSirasi` ayrı bir fonksiyon olarak duruyor çünkü hatası SESSİZ: fark yanlış
 * yöne yazılırsa pano en küçük tutarı en üste basar, hiçbir yerde hata çıkmaz.
 */
describe("kart sıralaması", () => {
  const kart = (onem: KartOnem, etki?: number): Kart => ({
    kod: "K-TST-01",
    surum: 1,
    onem,
    ozneTuru: "company",
    ozneId: "c1",
    baslik: "",
    gerekce: "",
    aksiyonlar: [],
    olcum: {},
    ...(etki === undefined ? {} : { etki }),
  })

  it("önem kademesi her zaman tutarın önünde gelir", () => {
    // ₺3,2 trilyonluk "yüksek" kart, ₺1'lik "kritik" kartı GEÇEMEZ.
    const sirali = [kart("yuksek", 3_213_123_123_123), kart("kritik", 1)].sort(kartSirasi)
    expect(sirali.map((k) => k.onem)).toEqual(["kritik", "yuksek"])
  })

  it("aynı kademede büyük tutar öne geçer", () => {
    const sirali = [kart("yuksek", 5_500), kart("yuksek", 100_000)].sort(kartSirasi)
    expect(sirali.map((k) => k.etki)).toEqual([100_000, 5_500])
  })

  it("parası olmayan kart kendi kademesinin sonuna düşer, kademeyi terk etmez", () => {
    const sirali = [kart("orta", 10), kart("kritik"), kart("kritik", 5)].sort(kartSirasi)
    expect(sirali.map((k) => [k.onem, k.etki ?? 0])).toEqual([
      ["kritik", 5],
      ["kritik", 0],
      ["orta", 10],
    ])
  })
})
