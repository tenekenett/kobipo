import { describe, expect, it } from "vitest"
import { ublFaturaOku, ublIrsaliyeOku } from "./ubl"
import { ublTuruBul } from "./girdi/xml-ek"

// UBL-TR e-Arşiv faturası — GİB kılavuzundaki yapının kısaltılmış hâli.
export const ORNEK_FATURA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>
  <cbc:ID>RYP2026000000123</cbc:ID>
  <cbc:UUID>6F1C2A3E-1111-2222-3333-444455556666</cbc:UUID>
  <cbc:IssueDate>2026-09-21</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:DespatchDocumentReference><cbc:ID>IRS2026000000009</cbc:ID><cbc:IssueDate>2026-09-20</cbc:IssueDate></cac:DespatchDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">7352344835</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>REYPO BİLİŞİM A.Ş.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Örnek Cad.</cbc:StreetName><cbc:BuildingNumber>5</cbc:BuildingNumber><cbc:CitySubdivisionName>Merkezefendi</cbc:CitySubdivisionName><cbc:CityName>Denizli</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Çınar</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">3531285187</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>EREN FORKLİFT</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>1</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-10-21</cbc:PaymentDueDate>
    <cac:PayeeFinancialAccount><cbc:ID>TR330006100519786457841326</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="TRY">50.00</cbc:Amount></cac:AllowanceCharge>
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">180.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">800.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">160.00</cbc:TaxAmount><cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">200.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount><cbc:Percent>10</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">1050.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">1180.00</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="TRY">50.00</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="TRY">1180.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">850.00</cbc:LineExtensionAmount>
    <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="TRY">50.00</cbc:Amount></cac:AllowanceCharge>
    <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">160.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">800.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">160.00</cbc:TaxAmount><cbc:Percent>20</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Forklift Lastiği</cbc:Name><cac:SellersItemIdentification><cbc:ID>LST-001</cbc:ID></cac:SellersItemIdentification></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">450.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="HUR">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">200.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">200.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount><cbc:Percent>10</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Servis</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">200.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`

const ORNEK_IRSALIYE_XML = `<?xml version="1.0"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:x:cac" xmlns:cbc="urn:x:cbc">
  <cbc:ID>IRS2026000000009</cbc:ID><cbc:UUID>AAAA-1</cbc:UUID><cbc:IssueDate>2026-09-20</cbc:IssueDate>
  <cac:DespatchSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">7352344835</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>REYPO</cbc:Name></cac:PartyName></cac:Party></cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="TCKN">12345678901</cbc:ID></cac:PartyIdentification><cac:Party><cac:Person><cbc:FirstName>Ali</cbc:FirstName><cbc:FamilyName>Veli</cbc:FamilyName></cac:Person></cac:Party></cac:Party></cac:DeliveryCustomerParty>
  <cac:Shipment><cac:ShipmentStage><cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID>20ABC123</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans><cac:DriverPerson><cbc:FirstName>Mehmet</cbc:FirstName><cbc:FamilyName>Şoför</cbc:FamilyName></cac:DriverPerson></cac:ShipmentStage>
    <cac:Delivery><cac:Despatch><cbc:ActualDespatchDate>2026-09-20</cbc:ActualDespatchDate></cac:Despatch></cac:Delivery></cac:Shipment>
  <cac:DespatchLine><cbc:ID>1</cbc:ID><cbc:DeliveredQuantity unitCode="C62">2</cbc:DeliveredQuantity><cac:Item><cbc:Name>Forklift Lastiği</cbc:Name></cac:Item></cac:DespatchLine>
</DespatchAdvice>`

describe("ublFaturaOku", () => {
  it("UBL-TR faturayı şemaya birebir doldurur", () => {
    expect(ublTuruBul(ORNEK_FATURA_XML)).toBe("INVOICE")
    const f = ublFaturaOku(ORNEK_FATURA_XML)!
    expect(f.faturaNo).toBe("RYP2026000000123")
    expect(f.ettn).toBe("6f1c2a3e-1111-2222-3333-444455556666")
    expect(f.saticiVknTckn).toBe("7352344835")
    expect(f.aliciVknTckn).toBe("3531285187")
    expect(f.saticiVergiDairesi).toBe("Çınar")
    expect(f.saticiAdres).toContain("Denizli")
    expect(f.senaryo).toBe("EARSIVFATURA")
    expect(f.tip).toBe("SATIS")
    expect(f.vade).toBe("2026-10-21")
    expect(f.irsaliyeNoListesi).toEqual(["IRS2026000000009"])
    expect(f.odemeNotu).toContain("TR330006100519786457841326")
    expect(f.kalemler).toHaveLength(2)
    expect(f.kalemler[0]).toMatchObject({ ad: "Forklift Lastiği", saticiKodu: "LST-001", miktar: 2, birim: "C62", birimFiyat: 450, iskontoTutar: 50, kdvOrani: 20, kdvTutar: 160, satirTutar: 850 })
    expect(f.kalemler[1]).toMatchObject({ birim: "HUR", kdvOrani: 10, satirTutar: 200, iskontoTutar: null })
    expect(f.kdvKirilimi).toEqual([{ oran: 20, matrah: 800, kdv: 160 }, { oran: 10, matrah: 200, kdv: 20 }])
    expect(f.genelIskonto).toBe(50)
    expect(f.matrahToplam).toBe(1050)
    expect(f.kdvToplam).toBe(180)
    expect(f.odenecek).toBe(1180)
  })

  it("Invoice kökü yoksa null", () => {
    expect(ublFaturaOku("<Foo/>")).toBeNull()
    expect(ublTuruBul("<x:CreditNote/>")).toBe("DIGER")
  })
})

describe("ublIrsaliyeOku", () => {
  it("DespatchAdvice'ı şemaya doldurur", () => {
    expect(ublTuruBul(ORNEK_IRSALIYE_XML)).toBe("DESPATCHADVICE")
    const i = ublIrsaliyeOku(ORNEK_IRSALIYE_XML)!
    expect(i.irsaliyeNo).toBe("IRS2026000000009")
    expect(i.saticiVknTckn).toBe("7352344835")
    expect(i.aliciVknTckn).toBe("12345678901")
    expect(i.plaka).toBe("20ABC123")
    expect(i.sofor).toBe("Mehmet Şoför")
    expect(i.sevkTarihi).toBe("2026-09-20")
    expect(i.kalemler).toEqual([{ ad: "Forklift Lastiği", saticiKodu: null, miktar: 2, birim: "C62" }])
  })
})
