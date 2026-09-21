/**
 * UBL-TR XML → çıkarım şeması. Belirlilik merdiveninin 1. basamağı: XML varsa
 * model HİÇ çağrılmaz, belgenin tamamı buradan gelir (maliyet 0, hata 0).
 *
 * `app/api/import` içindeki `parseUblInvoices` BİLEREK yeniden kullanılmadı:
 * o parser içe aktarım ekranı için yazılmış (anahtar son-ekiyle gevşek arama,
 * kaynak XML'in resmî toplamına tamamlama) ve ETTN, satır iskontosu, irsaliye
 * atfı, tevkifat, senaryo gibi alanları vermiyor. Burası UBL-TR'yi ad ad okur
 * (`removeNSPrefix` ile `cbc:`/`cac:` düşer), şemaya BİREBİR doldurur.
 *
 * Saf modül; sunucuda çalışır (fast-xml-parser), istemciye gitmez.
 */

import { XMLParser } from "fast-xml-parser"
import type { Fatura, FaturaKalem, FaturaKdv } from "./fatura/schema"
import type { Irsaliye, IrsaliyeKalem } from "./irsaliye/schema"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // Sayısal metinleri KENDİMİZ çeviriyoruz: "0012345" gibi kodlar sayıya dönüşmesin.
  parseTagValue: false,
  trimValues: true,
})

type Dugum = any

const dizi = (v: Dugum): Dugum[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const metin = (v: Dugum): string | null => {
  if (v == null) return null
  if (typeof v === "object") return v["#text"] != null ? String(v["#text"]).trim() || null : null
  const s = String(v).trim()
  return s || null
}
const sayi = (v: Dugum): number | null => {
  const s = metin(v)
  if (s == null) return null
  const n = Number(s.replace(",", "."))
  return Number.isFinite(n) ? n : null
}
const nitelik = (v: Dugum, ad: string): string | null =>
  v && typeof v === "object" ? metin(v["@_" + ad]) : null

/** PartyIdentification içinde schemeID VKN/TCKN olan ID. */
function tarafVkn(party: Dugum): string | null {
  for (const p of dizi(party?.PartyIdentification)) {
    const scheme = (nitelik(p?.ID, "schemeID") ?? "").toUpperCase()
    if (scheme === "VKN" || scheme === "TCKN") return metin(p?.ID)
  }
  // Bazı üreticiler şema kimliği yazmaz: 10/11 haneli ilk ID.
  for (const p of dizi(party?.PartyIdentification)) {
    const id = metin(p?.ID)?.replace(/\D/g, "")
    if (id && (id.length === 10 || id.length === 11)) return id
  }
  return metin(party?.PartyTaxScheme?.CompanyID)
}

function tarafUnvan(party: Dugum): string | null {
  const ad = metin(party?.PartyName?.Name)
  if (ad) return ad
  const legal = metin(party?.PartyLegalEntity?.RegistrationName)
  if (legal) return legal
  const kisi = party?.Person
  const tam = [metin(kisi?.FirstName), metin(kisi?.FamilyName)].filter(Boolean).join(" ")
  return tam || null
}

function tarafAdres(party: Dugum): string | null {
  const a = party?.PostalAddress
  if (!a) return null
  const parcalar = [
    metin(a.StreetName),
    metin(a.BuildingName),
    metin(a.BuildingNumber) ? "No:" + metin(a.BuildingNumber) : null,
    metin(a.CitySubdivisionName),
    metin(a.CityName),
  ].filter(Boolean)
  return parcalar.length ? parcalar.join(" ") : null
}

function ublKok(xml: string, ad: "Invoice" | "DespatchAdvice"): Dugum | null {
  const p = parser.parse(xml)
  return p?.[ad] ?? null
}

/** UBL-TR Invoice → Fatura. Kök yoksa null. */
export function ublFaturaOku(xml: string): Fatura | null {
  const inv = ublKok(xml, "Invoice")
  if (!inv) return null

  const satici = inv.AccountingSupplierParty?.Party
  const alici = inv.AccountingCustomerParty?.Party

  const kalemler: FaturaKalem[] = dizi(inv.InvoiceLine).map((l: Dugum): FaturaKalem => {
    const miktar = sayi(l.InvoicedQuantity)
    const birim = nitelik(l.InvoicedQuantity, "unitCode")
    const birimFiyat = sayi(l.Price?.PriceAmount)
    // Satır iskontosu: AllowanceCharge ChargeIndicator=false
    let iskonto = 0
    for (const ac of dizi(l.AllowanceCharge)) {
      const charge = String(metin(ac?.ChargeIndicator) ?? "false").toLowerCase() === "true"
      const tutar = sayi(ac?.Amount) ?? 0
      if (!charge) iskonto += tutar
      else iskonto -= tutar
    }
    // KDV: TaxSubtotal içinde TaxScheme/TaxTypeCode 0015; tevkifat 9015 (WithholdingTaxTotal)
    let kdvOrani: number | null = null
    let kdvTutar: number | null = null
    for (const st of dizi(l.TaxTotal?.TaxSubtotal)) {
      const kod = metin(st?.TaxCategory?.TaxScheme?.TaxTypeCode)
      if (kod == null || kod === "0015") {
        kdvOrani = sayi(st?.Percent)
        kdvTutar = sayi(st?.TaxAmount)
        break
      }
    }
    let tevkifat: number | null = null
    for (const st of dizi(l.WithholdingTaxTotal?.TaxSubtotal)) {
      const p = sayi(st?.Percent)
      if (p != null) tevkifat = p / 100
    }
    const item = l.Item
    const saticiKodu = metin(item?.SellersItemIdentification?.ID) ?? metin(item?.ManufacturersItemIdentification?.ID)
    return {
      ad: metin(item?.Name) ?? metin(item?.Description) ?? "Kalem",
      saticiKodu,
      miktar,
      birim,
      birimFiyat,
      iskontoTutar: iskonto ? Math.round(iskonto * 100) / 100 : null,
      kdvOrani,
      kdvTutar,
      satirTutar: sayi(l.LineExtensionAmount),
      tevkifatOrani: tevkifat,
    }
  })

  // Dip KDV kırılımı
  const kdvKirilimi: FaturaKdv[] = []
  for (const tt of dizi(inv.TaxTotal)) {
    for (const st of dizi(tt?.TaxSubtotal)) {
      const kod = metin(st?.TaxCategory?.TaxScheme?.TaxTypeCode)
      if (kod != null && kod !== "0015") continue
      const oran = sayi(st?.Percent)
      if (oran == null) continue
      kdvKirilimi.push({ oran, matrah: sayi(st?.TaxableAmount), kdv: sayi(st?.TaxAmount) })
    }
  }
  let tevkifatToplam: number | null = null
  for (const wt of dizi(inv.WithholdingTaxTotal)) {
    const t = sayi(wt?.TaxAmount)
    if (t != null) tevkifatToplam = (tevkifatToplam ?? 0) + t
  }

  const lmt = inv.LegalMonetaryTotal ?? {}
  // Belge düzeyi iskonto/ilave: kök AllowanceCharge
  let genelIskonto = 0
  for (const ac of dizi(inv.AllowanceCharge)) {
    const charge = String(metin(ac?.ChargeIndicator) ?? "false").toLowerCase() === "true"
    const tutar = sayi(ac?.Amount) ?? 0
    genelIskonto += charge ? -tutar : tutar
  }
  if (!genelIskonto) genelIskonto = sayi(lmt.AllowanceTotalAmount) ?? 0

  const irsaliyeler = dizi(inv.DespatchDocumentReference)
    .map((d: Dugum) => metin(d?.ID))
    .filter((x: string | null): x is string => !!x)

  const odemeNotu = [
    metin(inv.PaymentMeans?.PayeeFinancialAccount?.ID) ? "IBAN " + metin(inv.PaymentMeans?.PayeeFinancialAccount?.ID) : null,
    metin(inv.PaymentTerms?.Note),
  ]
    .filter(Boolean)
    .join(" · ")

  return {
    saticiUnvan: tarafUnvan(satici),
    saticiVknTckn: tarafVkn(satici),
    saticiVergiDairesi: metin(satici?.PartyTaxScheme?.TaxScheme?.Name),
    saticiAdres: tarafAdres(satici),
    aliciUnvan: tarafUnvan(alici),
    aliciVknTckn: tarafVkn(alici),
    faturaNo: metin(inv.ID),
    ettn: metin(inv.UUID)?.toLowerCase() ?? null,
    tarih: metin(inv.IssueDate),
    vade: metin(inv.PaymentMeans?.PaymentDueDate) ?? metin(inv.PaymentTerms?.PaymentDueDate),
    senaryo: metin(inv.ProfileID),
    tip: metin(inv.InvoiceTypeCode),
    paraBirimi: metin(inv.DocumentCurrencyCode) ?? "TRY",
    kalemler,
    kdvKirilimi,
    genelIskonto: genelIskonto || null,
    kdvsizEk: null,
    matrahToplam: sayi(lmt.LineExtensionAmount),
    kdvToplam: kdvKirilimi.reduce((a, k) => a + (k.kdv ?? 0), 0) || sayi(dizi(inv.TaxTotal)[0]?.TaxAmount),
    tevkifatToplam,
    odenecek: sayi(lmt.PayableAmount),
    irsaliyeNoListesi: irsaliyeler,
    odemeNotu: odemeNotu || null,
    // XML kaynaktır: güven 1 — denetimler yine koşar.
    guven: { satici: 1, alici: 1, tarih: 1, toplam: 1, kalemler: 1 },
  }
}

/** UBL-TR DespatchAdvice → Irsaliye. Kök yoksa null. */
export function ublIrsaliyeOku(xml: string): Irsaliye | null {
  const d = ublKok(xml, "DespatchAdvice")
  if (!d) return null
  const satici = d.DespatchSupplierParty?.Party
  const alici = d.DeliveryCustomerParty?.Party
  const shipment = d.Shipment
  const stage = dizi(shipment?.ShipmentStage)[0]
  const plaka = metin(stage?.TransportMeans?.RoadTransport?.LicensePlateID)
  const sofor = dizi(stage?.DriverPerson)[0]
  const soforAdi = [metin(sofor?.FirstName), metin(sofor?.FamilyName)].filter(Boolean).join(" ") || null
  const tasiyici = tarafUnvan(d.CarrierParty)
  const teslimAdres = shipment?.Delivery?.DeliveryAddress
  const sevkAdresi = teslimAdres
    ? [metin(teslimAdres.StreetName), metin(teslimAdres.CitySubdivisionName), metin(teslimAdres.CityName)].filter(Boolean).join(" ")
    : null

  const kalemler: IrsaliyeKalem[] = dizi(d.DespatchLine).map((l: Dugum) => ({
    ad: metin(l.Item?.Name) ?? metin(l.Item?.Description) ?? "Kalem",
    saticiKodu: metin(l.Item?.SellersItemIdentification?.ID),
    miktar: sayi(l.DeliveredQuantity),
    birim: nitelik(l.DeliveredQuantity, "unitCode"),
  }))

  return {
    saticiUnvan: tarafUnvan(satici),
    saticiVknTckn: tarafVkn(satici),
    aliciUnvan: tarafUnvan(alici),
    aliciVknTckn: tarafVkn(alici),
    irsaliyeNo: metin(d.ID),
    ettn: metin(d.UUID)?.toLowerCase() ?? null,
    duzenlemeTarihi: metin(d.IssueDate),
    sevkTarihi: metin(shipment?.Delivery?.Despatch?.ActualDespatchDate) ?? metin(d.IssueDate),
    tasiyici,
    plaka,
    sofor: soforAdi,
    sevkAdresi: sevkAdresi || null,
    faturaNoAtfi: metin(dizi(d.AdditionalDocumentReference)[0]?.ID),
    kalemler,
    guven: { satici: 1, alici: 1, tarih: 1, kalemler: 1 },
  }
}
