// Mizandan bilanço / gelir tablosu (mali-tablolar.ts) ve dönem kapanışı (kapanis.ts).

import { describe, expect, it } from "vitest"
import { mizanKur, type MizanHareketi } from "./mizan"
import { bilancoKur, gelirTablosuKur } from "./mali-tablolar"
import { kapanisPlani } from "./kapanis"

/** Basit örnek defter: kod → [borç, alacak] dönem hareketi. */
function mizan(hareket: Record<string, [number, number]>) {
  const h: MizanHareketi[] = Object.entries(hareket).map(([kod, [b, a]]) => ({
    kod,
    devirBorc: 0,
    devirAlacak: 0,
    donemBorc: b,
    donemAlacak: a,
  }))
  return mizanKur(h, new Map())
}

// Sermaye 1000 · satış 1000+200 KDV · alış 500+100 KDV (stoklu) · kira 300 kasadan · tahsilat 1200.
const ORNEK = {
  "100": [1000 + 1200, 300],
  "120.01.0001": [1200, 1200],
  "153": [500, 0],
  "191": [100, 0],
  "320.01.0001": [0, 600],
  "391": [0, 200],
  "500": [0, 1000],
  "600": [0, 1000],
  "770": [300, 0],
} as Record<string, [number, number]>

describe("mizan", () => {
  it("alt hesap üstlerine toplanır; düzey toplamlarında borç = alacak", () => {
    const m = mizan(ORNEK)
    const k120 = m.find((s) => s.kod === "120")!
    expect(k120.toplamBorc).toBe(1200)
    expect(m.find((s) => s.kod === "1")!.bakiyeBorc).toBe(1900 + 500 + 100)
    const kebir = m.filter((s) => s.duzey === 3)
    const b = kebir.reduce((a, s) => a + s.bakiyeBorc, 0)
    const a = kebir.reduce((x, s) => x + s.bakiyeAlacak, 0)
    expect(Math.round(b * 100) / 100).toBe(Math.round(a * 100) / 100)
  })

  it("ters bakiye işaretlenir (kasada alacak bakiyesi)", () => {
    const m = mizan({ "100": [0, 50], "500": [50, 0] })
    expect(m.find((s) => s.kod === "100")!.tersBakiye).toBe(true)
  })
})

describe("bilanço", () => {
  it("kapanmamış dönem sonucu öz kaynaklarda; aktif = pasif", () => {
    const b = bilancoKur(mizan(ORNEK))
    expect(b.aktifToplam).toBe(2500)
    expect(b.pasifToplam).toBe(2500)
    expect(b.kapanmamisSonuc).toBe(700)
    const oz = b.pasif.find((p) => p.kod === "5")!
    expect(oz.gruplar.find((g) => g.kod === "59")!.tutar).toBe(700)
  })

  it("alacak bakiyeli müşteri 340, borç bakiyeli tedarikçi 159 olarak sınıflanır", () => {
    const b = bilancoKur(
      mizan({
        "100": [500, 0],
        "120.01.0001": [300, 0],
        "120.01.0002": [0, 200],
        "320.01.0001": [80, 0],
        "500": [0, 680],
      }),
    )
    const satir = (bolum: "aktif" | "pasif", kod: string) =>
      b[bolum].flatMap((x) => x.gruplar.flatMap((g) => g.satirlar)).find((s) => s.kod === kod)?.tutar
    expect(satir("aktif", "120")).toBe(300)
    expect(satir("pasif", "340")).toBe(200)
    expect(satir("aktif", "159")).toBe(80)
    expect(b.aktifToplam).toBe(b.pasifToplam)
  })
})

describe("gelir tablosu", () => {
  it("7/A gideri karşılık 6xx satırına okunur (770 → 632)", () => {
    const g = gelirTablosuKur(mizan(ORNEK))
    const kalem = (ad: string) => g.kalemler.find((k) => k.ad === ad)!.tutar
    expect(kalem("Brüt Satışlar")).toBe(1000)
    expect(kalem("Faaliyet Giderleri (-)")).toBe(300)
    expect(g.netKar).toBe(700)
  })
})

describe("dönem kapanışı", () => {
  it("SMM (sayım), yansıtma, 690, 590 ve bilanço kapanış/açılış fişleri dengeli", () => {
    const p = kapanisPlani({ yil: 2026, mizan: mizan(ORNEK), kapanisStoku: 200 })
    expect(p.hatalar).toEqual([])
    expect(p.fisler.map((f) => f.anahtar)).toEqual(["smm", "yansitma", "gelir-kapanis", "kar", "bilanco-kapanis", "acilis"])
    expect(p.netKar).toBe(400) // 1000 satış − 300 SMM − 300 kira
    const smm = p.fisler.find((f) => f.anahtar === "smm")!
    expect(smm.satirlar).toEqual([
      { taraf: "B", tutar: 300, kod: "621", aciklama: "Satılan ticari mallar maliyeti" },
      { taraf: "A", tutar: 300, kod: "153", aciklama: "Dönem sonu stok farkı" },
    ])
    const kar = p.fisler.find((f) => f.anahtar === "kar")!
    expect(kar.satirlar.map((s) => `${s.taraf} ${s.kod} ${s.tutar}`)).toEqual(["B 690 400", "A 590 400"])
    const kapanis = p.fisler.find((f) => f.anahtar === "bilanco-kapanis")!
    expect(kapanis.tarih.toISOString().slice(0, 10)).toBe("2026-12-31")
    expect(p.fisler.find((f) => f.anahtar === "acilis")!.tarih.toISOString().slice(0, 10)).toBe("2027-01-01")
    // Açılışta stok sayım tutarıyla, kâr 590'da.
    const acilis = p.fisler.find((f) => f.anahtar === "acilis")!
    expect(acilis.satirlar.find((s) => s.kod === "153")).toMatchObject({ taraf: "B", tutar: 200 })
    expect(acilis.satirlar.find((s) => s.kod === "590")).toMatchObject({ taraf: "A", tutar: 400 })
  })

  it("zarar 591'e; sayım girilmezse SMM atlanır ve uyarılır", () => {
    const p = kapanisPlani({
      yil: 2026,
      mizan: mizan({ "100": [100, 400], "153": [300, 0], "500": [0, 100], "770": [400, 0], "320.01.0001": [0, 300] }),
    })
    expect(p.hatalar).toEqual([])
    expect(p.uyarilar.some((u) => u.includes("sayım"))).toBe(true)
    expect(p.netKar).toBe(-400)
    expect(p.fisler.find((f) => f.anahtar === "kar")!.satirlar.map((s) => `${s.taraf} ${s.kod}`)).toEqual(["B 591", "A 690"])
  })

  it("hedef hesap alt hesaplıysa kapanış yapılmaz", () => {
    const p = kapanisPlani({ yil: 2026, mizan: mizan({ ...ORNEK, "770": [0, 0], "632.01": [300, 0] }) })
    expect(p.hatalar.some((h) => h.startsWith("632 alt hesaplı"))).toBe(false) // 632'ye yansıyan 7xx yok
    const p2 = kapanisPlani({ yil: 2026, mizan: mizan({ ...ORNEK, "632.01": [0, 0] }) })
    expect(p2.hatalar.some((h) => h.startsWith("632 alt hesaplı"))).toBe(true)
  })
})
