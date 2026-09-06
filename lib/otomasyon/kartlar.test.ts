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

/**
 * Karttaki bütün `href` değerleri.
 *
 * Şablon dizeleri de alınır (`/stok/${slug}`); değişken parçalar tek bir
 * segmentlik yer tutucuya indirgenir, çünkü rota eşlemesinde önemli olan
 * segment SAYISI ve dinamik olup olmadığıdır, değerin kendisi değil.
 */
function hrefler(): string[] {
  const bulunan = [...kaynak.matchAll(/href: (`[^`]+`|"[^"]+")/g)].map((m) =>
    m[1]
      .slice(1, -1)
      .replace(/\$\{[^}]*\}/g, "SEGMENT")
      .split("?")[0]
  )
  return [...new Set(bulunan)]
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
})
