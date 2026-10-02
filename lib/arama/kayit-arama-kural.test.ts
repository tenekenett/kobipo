// Genel kayıt araması — saf kurallar (kayit-arama-kural.ts).

import { describe, expect, it } from "vitest"
import type { PagePermissions } from "@/lib/page-access"
import { moduleKeyForPath } from "@/lib/nav/pages"
import { altSatir, aramaTerimi, belgeHedefi, kayitAcikMi, tutarMetni } from "./kayit-arama-kural"

const rol = (role: string, allowedPaths: string[] = []): PagePermissions => ({
  role: role as PagePermissions["role"],
  allowedPaths,
  writablePaths: [],
})

describe("aramaTerimi", () => {
  it("boşlukları toplar; 2 karakterden kısa terimle aranmaz", () => {
    expect(aramaTerimi("  SAT-2026   0120 ")).toBe("SAT-2026 0120")
    expect(aramaTerimi("a")).toBeNull()
    expect(aramaTerimi("   ")).toBeNull()
    expect(aramaTerimi(null)).toBeNull()
    expect(aramaTerimi("ış")).toBe("ış")
  })

  it("uzun terim kırpılır", () => {
    expect(aramaTerimi("x".repeat(500))?.length).toBe(80)
  })
})

describe("belgeHedefi", () => {
  const b = (type: string, returnKind: string | null = null, isReceipt = false) =>
    belgeHedefi({ id: "f1", type, returnKind, isReceipt })

  it("fatura önizlemeye, fiş fiş sayfasına gider", () => {
    expect(b("SALES").path).toBe("/faturalar/f1/onizleme")
    expect(b("SALES", null, true).path).toBe("/fisler/f1")
  })

  it("liste sayfası ailesine göre: satış/alış, iade kendi ailesinde", () => {
    expect(b("SALES")).toMatchObject({ liste: "/satis/fatura", turAdi: "Satış faturası" })
    expect(b("PURCHASE")).toMatchObject({ liste: "/alis/fatura", turAdi: "Alış faturası" })
    expect(b("RETURN", "PURCHASE")).toMatchObject({ liste: "/alis/fatura", turAdi: "Alış iadesi" })
    // Yönü boş eski iade satış iadesidir (kdv-kural ile aynı varsayım).
    expect(b("RETURN", null)).toMatchObject({ liste: "/satis/fatura", turAdi: "Satış iadesi" })
    expect(b("PURCHASE", null, true)).toMatchObject({ liste: "/alis/fisler", turAdi: "Alış fişi" })
  })
})

describe("kayitAcikMi", () => {
  const satisFaturasi = belgeHedefi({ id: "f1", type: "SALES", returnKind: null, isReceipt: false })
  const alisFaturasi = belgeHedefi({ id: "f2", type: "PURCHASE", returnKind: null, isReceipt: false })

  it("yönetici her ikisini açar", () => {
    expect(kayitAcikMi(rol("ADMIN"), [], satisFaturasi)).toBe(true)
    expect(kayitAcikMi(rol("ADMIN"), [], alisFaturasi)).toBe(true)
  })

  it("satışçı alış faturasını bulamaz — detay sayfasının sahibi ortak olsa da", () => {
    expect(kayitAcikMi(rol("SALES"), [], satisFaturasi)).toBe(true)
    expect(kayitAcikMi(rol("SALES"), [], alisFaturasi)).toBe(false)
  })

  it("yalnız alış listesine izinli kısıtlı üye satış faturasını bulamaz", () => {
    const kisitli = rol("ADMIN", ["/alis/fatura"])
    expect(kayitAcikMi(kisitli, [], alisFaturasi)).toBe(true)
    expect(kayitAcikMi(kisitli, [], satisFaturasi)).toBe(false)
  })

  it("kapalı modülün kaydı bulunmaz", () => {
    const urun = { liste: "/stok/urunler", path: "/stok/un-50-kg" }
    const modul = moduleKeyForPath(urun.liste)
    expect(modul).toBeTruthy()
    expect(kayitAcikMi(rol("ADMIN"), [], urun)).toBe(true)
    expect(kayitAcikMi(rol("ADMIN"), [modul!], urun)).toBe(false)
  })

  it("personel yalnız yönetim rollerine", () => {
    const kisi = { liste: "/personel", path: "/personel/ali-yilmaz" }
    expect(kayitAcikMi(rol("ADMIN"), [], kisi)).toBe(true)
    expect(kayitAcikMi(rol("SALES"), [], kisi)).toBe(false)
  })
})

describe("metin yardımcıları", () => {
  it("tutar: TL simgeli, döviz kodlu", () => {
    expect(tutarMetni(2358.63)).toBe("₺2.358,63")
    expect(tutarMetni("1500", "USD")).toBe("1.500,00 USD")
  })

  it("alt satır boş parçaları atar", () => {
    expect(altSatir("Müşteri", null, "", false, "0555")).toBe("Müşteri · 0555")
  })
})
