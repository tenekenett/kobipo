import { describe, expect, it } from "vitest"
import {
  describeMembershipChange,
  describePageForbidden,
  describeRoleChange,
  diffPermissions,
  membershipPermissions,
  pageLabel,
  type MembershipSnapshot,
} from "./permission-log"

const member = (
  role: string,
  allowedPaths: string[] = [],
  writablePaths: string[] = [],
  customRole: MembershipSnapshot["customRole"] = null
): MembershipSnapshot => ({ role, allowedPaths, writablePaths, customRole })

// 2026-10-05, EREN VİNÇ: kısıtsız ADMIN grup bazında daraltıldı — Satış, Stok, Finans,
// E-Dönüşüm tam; Kontör salt okunur; Alış, Ayarlar, Raporlar, Personel, Restoran kapalı.
// Canlıdaki 25 sayfanın ikisi profil/destek — herkese açık, günlükte sayılmaz (23).
const SATIS = ["/satis/fatura", "/cari/musteri", "/satis/irsaliye", "/satis/siparis", "/satis/hizli", "/satis/fisler", "/satis/z-raporlari", "/teklif"]
const STOK = ["/stok/urunler", "/stok/hizmetler", "/depolar", "/stok/transfer", "/stok/etiket"]
const FINANS = ["/finans/kanallar", "/finans/hareketler", "/finans/mutabakat", "/cek-senet/cek", "/cek-senet/senet"]
const EDONUSUM = ["/ayarlar/e-donusum", "/e-donusum/seri-no", "/e-donusum/sablon"]
const writable = ["/dashboard", ...SATIS, ...STOK, ...FINANS, ...EDONUSUM]
const erenVincOnce = member("ADMIN")
const erenVincSonra = member("ADMIN", [...writable, "/e-donusum/kontor"], writable)

describe("üyelik farkı", () => {
  it("bugünkü daraltma: kaldırılanlar ve salt okunura düşenler yazılır", () => {
    const entry = describeMembershipChange(erenVincOnce, erenVincSonra)!
    expect(entry.action).toBe("UPDATE_USER_COMPANY")
    expect(entry.headline).toMatch(/^Yetki değişti — kaldırılan \d+, salt okunura düşen 1$/)
    const text = entry.lines.join("\n")
    expect(text).toContain("Önce: kısıtsız — rolün tüm sayfaları")
    expect(text).toMatch(/Sonra: kısıtlı — 23 sayfa · Düzenle \(22\)/)
    // Fatura sorununu doğuran kayıp kayıtta adıyla görünmeli.
    expect(text).toMatch(/Kaldırılan \(\d+\): .*Firma Bilgileri/)
    expect(text).toMatch(/Kaldırılan \(\d+\): .*Alış Faturası/)
    expect(text).toContain("Salt okunura düşen (1): Kontör")
  })

  it("hiçbir şey değişmediyse kayıt yok", () => {
    expect(describeMembershipChange(erenVincSonra, erenVincSonra)).toBeNull()
    expect(describeMembershipChange(member("SALES"), member("SALES"))).toBeNull()
  })

  it("eklenen sayfa erişimiyle yazılır", () => {
    const entry = describeMembershipChange(erenVincSonra, member("ADMIN", [...erenVincSonra.allowedPaths, "/ayarlar/firma"], writable))!
    expect(entry.lines.join("\n")).toContain("Eklenen (1): Firma Bilgileri [Görüntüle]")
  })

  it("üyelik açılması ve kaldırılması", () => {
    const added = describeMembershipChange(null, member("SALES"))!
    expect(added.action).toBe("ADD_USER_COMPANY")
    expect(added.headline).toMatch(/^Üyelik açıldı — Satış, kısıtsız, \d+ sayfa$/)
    const removed = describeMembershipChange(erenVincSonra, null)!
    expect(removed.action).toBe("REMOVE_USER_COMPANY")
    expect(removed.headline).toBe("Üyelik kaldırıldı — Yönetici, kısıtlı, 23 sayfa")
  })

  it("özel rol ataması rol adıyla ve rolün listesiyle yazılır", () => {
    const rol = { id: "r1", name: "Kasiyer", allowedPaths: ["/satis/hizli"], writablePaths: ["/satis/hizli"] }
    const entry = describeMembershipChange(member("SALES"), member("CUSTOM", [], [], rol))!
    expect(entry.headline).toContain("Satış → Özel rol «Kasiyer»")
    expect(entry.lines.join("\n")).toContain("Sonra: kısıtlı — 1 sayfa · Düzenle (1): Hızlı Satış")
  })

  it("izin, oturum bağlamı gibi çözülür: özel rolde liste rolden gelir", () => {
    const rol = { id: "r1", name: "Kasiyer", allowedPaths: ["/satis/hizli"], writablePaths: [] }
    // Üyelikte kalmış eski kişisel liste özel rolün yanında hiçbir şey ifade etmez.
    const p = membershipPermissions(member("CUSTOM", ["/satis/fatura"], ["/satis/fatura"], rol))
    expect(p).toEqual({ role: "CUSTOM", allowedPaths: ["/satis/hizli"], writablePaths: [], custom: true })
  })

  it("profil ve destek farka hiç girmez", () => {
    const d = diffPermissions(membershipPermissions(member("ADMIN")), membershipPermissions(member("ADMIN", ["/satis/fatura"])))
    const all = [...d.removed, ...d.added.map((x) => x.href), ...d.toReadOnly, ...d.toEdit]
    expect(all).not.toContain("/ayarlar/profil")
    expect(all).not.toContain("/ayarlar/destek")
  })
})

describe("özel rol farkı", () => {
  const rol = { name: "Kasiyer", allowedPaths: ["/satis/hizli", "/satis/fisler"], writablePaths: ["/satis/hizli"] }

  it("oluşturma, güncelleme, silme", () => {
    expect(describeRoleChange(null, rol)!.headline).toBe("Özel rol oluşturuldu «Kasiyer» — 2 sayfa")
    const updated = describeRoleChange(rol, { ...rol, allowedPaths: ["/satis/hizli"] })!
    expect(updated.action).toBe("UPDATE_COMPANY_ROLE")
    expect(updated.lines.join("\n")).toContain("Kaldırılan (1): Satış Fişleri")
    expect(describeRoleChange(rol, null)!.action).toBe("DELETE_COMPANY_ROLE")
  })

  it("yalnız ad değiştiyse de yazılır; hiçbir şey değişmediyse yazılmaz", () => {
    expect(describeRoleChange(rol, { ...rol, name: "Kasa" })!.headline).toContain("ad «Kasiyer» → «Kasa»")
    expect(describeRoleChange(rol, { ...rol })).toBeNull()
  })
})

describe("sayfa kapısı reddi", () => {
  const input = {
    method: "get",
    pathname: "/api/companies/cmogzz7g",
    rulePrefix: "/api/companies",
    requiredPages: ["/ayarlar/firma", "/ayarlar/sube-bilgileri"],
    permissions: membershipPermissions(erenVincSonra),
    companyLabel: "EREN VİNÇ",
    roleText: "Yönetici",
  }

  it("tekrar anahtarı kural ön ekidir, istek yolu değil — id her istekte değişir", () => {
    const a = describePageForbidden(input)
    const b = describePageForbidden({ ...input, pathname: "/api/companies/baska-firma" })
    expect(a.dedupPrefix).toBe("GET /api/companies — ")
    expect(b.dedupPrefix).toBe(a.dedupPrefix)
    expect(a.details.startsWith(a.dedupPrefix)).toBe(true)
  })

  it("ret neyin eksik olduğunu sayfa adıyla söyler", () => {
    const { details } = describePageForbidden(input)
    expect(details).toContain("İstek: GET /api/companies/cmogzz7g")
    expect(details).toContain("Gereken sayfalardan biri: Firma Bilgileri, Şube Bilgileri")
    expect(details).toContain("Üyelik: Yönetici — kısıtlı — 23 sayfa")
  })

  it("kuralsız uçta yazma reddi de anlaşılır", () => {
    const { dedupPrefix, details } = describePageForbidden({ ...input, method: "POST", pathname: "/api/kur", rulePrefix: null, requiredPages: [] })
    expect(dedupPrefix).toBe("POST /api/kur — ")
    expect(details).toContain("Kuralı olmayan uçta yazma kapalı")
  })
})

describe("sayfa etiketi", () => {
  it("iki menüde aynı adı taşıyan sayfaya grubu eklenir", () => {
    expect(pageLabel("/e-donusum/sablon")).toBe("Belge Şablonları (E-Dönüşüm)")
    expect(pageLabel("/personel/belge-sablonlari")).toBe("Belge Şablonları (Personel)")
    expect(pageLabel("/ayarlar/firma")).toBe("Firma Bilgileri")
  })
})
