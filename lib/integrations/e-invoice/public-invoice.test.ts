import { describe, expect, it } from "vitest"
import {
  isEligiblePublicAccount,
  isValidTrIban,
  normalizeIban,
  publicInvoiceErrorHint,
  resolvePublicInvoice,
  resolvePublicPayee,
  usesKamuProfile,
  type PublicInvoiceAccount,
} from "./public-invoice"

// Herkese açık örnek TR IBAN'ı (mod-97 geçerli). Gerçek müşteri IBAN'ı teste girmez.
const IBAN = "TR330006100519786457841326"
const IBAN_SPACED = "TR33 0006 1005 1978 6457 8413 26"

const acc = (patch: Partial<PublicInvoiceAccount> = {}): PublicInvoiceAccount => ({
  id: "a1",
  name: "Banka A",
  type: "BANK",
  iban: IBAN,
  currency: "TRY",
  isActive: true,
  ...patch,
})

describe("IBAN", () => {
  it("boşluk ve küçük harf normalize edilir", () => {
    expect(normalizeIban(" tr33 0006-1005 ")).toBe("TR3300061005")
  })
  it("geçerli TR IBAN'ı (boşluklu da) kabul eder", () => {
    expect(isValidTrIban(IBAN)).toBe(true)
    expect(isValidTrIban(IBAN_SPACED)).toBe(true)
  })
  it("kontrol hanesi bozuk IBAN'ı reddeder", () => {
    expect(isValidTrIban("TR340006100519786457841326")).toBe(false)
  })
  it("uzunluk ya da ülke yanlışsa reddeder", () => {
    expect(isValidTrIban("TR33000610051978645784132")).toBe(false)
    expect(isValidTrIban("DE89370400440532013000")).toBe(false)
    expect(isValidTrIban("")).toBe(false)
    expect(isValidTrIban(null)).toBe(false)
  })
})

describe("uygun hesap", () => {
  it("aktif + BANKA + TL + geçerli IBAN", () => {
    expect(isEligiblePublicAccount(acc())).toBe(true)
  })
  it("kasa, pasif, dövizli ya da IBAN'sız hesap uygun değil", () => {
    expect(isEligiblePublicAccount(acc({ type: "CASH" }))).toBe(false)
    expect(isEligiblePublicAccount(acc({ isActive: false }))).toBe(false)
    expect(isEligiblePublicAccount(acc({ currency: "USD" }))).toBe(false)
    expect(isEligiblePublicAccount(acc({ iban: null }))).toBe(false)
  })
})

describe("resolvePublicInvoice", () => {
  it("alıcı kamu değilse belge değişmez", () => {
    expect(resolvePublicInvoice({ isPublic: false, selectedAccountId: null, accounts: [], payee: null })).toEqual({
      ok: true,
      data: null,
    })
  })

  it("tek uygun hesap varsa o seçilir (kasa ve pasif sayılmaz)", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: null,
      accounts: [acc({ iban: IBAN_SPACED }), acc({ id: "k", type: "CASH", iban: null }), acc({ id: "p", isActive: false })],
      payee: null,
    })
    expect(r).toEqual({ ok: true, data: { iban: IBAN, accountName: "Banka A", payee: null } })
  })

  it("birden çok uygun hesap varsa Kobipo seçmez — kartta seçim ister", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: null,
      accounts: [acc(), acc({ id: "a2", name: "Banka B" })],
      payee: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("Banka A, Banka B")
      expect(r.error).toContain("müşteri kartında")
    }
  })

  it("uygun hesap yoksa IBAN girilmesini söyler", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: null,
      accounts: [acc({ iban: null })],
      payee: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("Finans Kanalları")
  })

  it("kartta seçilen hesap kullanılır, diğerleri yok sayılır", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: "a2",
      accounts: [acc(), acc({ id: "a2", name: "Banka B" })],
      payee: null,
    })
    expect(r.ok && r.data?.accountName).toBe("Banka B")
  })

  it("seçili hesap pasife alınmışsa sessizce başka hesaba düşmez", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: "a2",
      accounts: [acc(), acc({ id: "a2", name: "Banka B", isActive: false })],
      payee: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('"Banka B" pasif')
  })

  it("seçili hesap silinmişse hata verir", () => {
    const r = resolvePublicInvoice({ isPublic: true, selectedAccountId: "yok", accounts: [acc()], payee: null })
    expect(r.ok).toBe(false)
  })

  it("harcama birimi belgeye gider; ilçe boşsa il", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: null,
      accounts: [acc()],
      payee: { vkn: "123 456 7890", name: "  YAPI İŞLERİ DAİ. BŞK. ", city: "DENİZLİ", district: "" },
    })
    expect(r.ok && r.data?.payee).toEqual({
      vkn: "1234567890",
      name: "YAPI İŞLERİ DAİ. BŞK.",
      city: "DENİZLİ",
      district: "DENİZLİ",
    })
  })

  it("yarım harcama birimi belgeyi göndertmez", () => {
    const r = resolvePublicInvoice({
      isPublic: true,
      selectedAccountId: null,
      accounts: [acc()],
      payee: { vkn: "1234567890", name: "", city: "DENİZLİ" },
    })
    expect(r.ok).toBe(false)
  })
})

describe("resolvePublicPayee", () => {
  it("boşsa birim yok", () => {
    expect(resolvePublicPayee(null)).toEqual({ ok: true, payee: null })
    expect(resolvePublicPayee({ vkn: "", name: "", city: "" })).toEqual({ ok: true, payee: null })
  })
  it("VKN'siz ünvan yazılmışsa uyarır (sessizce düşmez)", () => {
    expect(resolvePublicPayee({ vkn: "", name: "X" }).ok).toBe(false)
  })
  it("VKN 10 hane değilse reddeder", () => {
    expect(resolvePublicPayee({ vkn: "12345678901", name: "X", city: "Y" }).ok).toBe(false)
  })
})

describe("profil", () => {
  const data = { iban: IBAN, accountName: "A", payee: { vkn: "1234567890", name: "B", city: "C", district: "C" } }
  it("harcama birimi varsa KAMU", () => {
    expect(usesKamuProfile(data, false)).toBe(true)
  })
  it("harcama birimi yoksa kullanıcının profili kalır", () => {
    expect(usesKamuProfile({ ...data, payee: null }, false)).toBe(false)
    expect(usesKamuProfile(null, false)).toBe(false)
  })
  it("iadede KAMU kullanılmaz (Mysoft TEMELFATURA ister)", () => {
    expect(usesKamuProfile(data, true)).toBe(false)
  })
})

describe("Mysoft hata eki", () => {
  it("kullanıcının gördüğü ret mesajını tanır", () => {
    expect(
      publicInvoiceErrorHint(
        "Kamuya düzenlenen belgelerde PaymentMeans.PayeeFinancialAccount alanı ilgili değerler ile doldurulmalıdır.",
      ),
    ).toContain("Kamu kurumu")
  })
  it("ilgisiz hataya ek yapmaz", () => {
    expect(publicInvoiceErrorHint("uygun numaratör bulunamadı")).toBeNull()
  })
})
