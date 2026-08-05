export interface EInvoiceProvider {
  name: string
  sendInvoice(invoice: InvoiceData): Promise<EInvoiceResponse>
  getInvoiceStatus(uuid: string): Promise<EInvoiceStatus>
  getIncomingInvoices(params: IncomingInvoiceParams): Promise<IncomingInvoice[]>
  cancelInvoice?(uuid: string, options?: { cancelType?: string; cancelNote?: string; cancelDate?: string }): Promise<{ success: boolean; error?: string; message?: string }>
  getInvoicePdf?(uuid: string): Promise<{ success: true; pdfBuffer: Buffer; filename?: string } | { success: false; error: string }>
}

export interface InvoiceData {
  invoiceNo: string
  date: Date
  dueDate?: Date
  invoiceType?: "E_INVOICE" | "E_ARCHIVE"
  // E-Fatura profili (kullanıcı seçimi): TICARIFATURA (alıcı yanıtı bekler) veya
  // TEMELFATURA (yanıt beklemez). Verilmezse provider TICARIFATURA ile başlar.
  // E-Arşiv'de yok sayılır (her zaman EARSIVFATURA).
  eInvoiceProfile?: "TICARIFATURA" | "TEMELFATURA"
  prefix?: string
  // Mysoft-specific routing fields (discover-mysoft-config'den)
  connectorGuid?: string
  pkAlias?: string
  gbAlias?: string
  tenantIdentifierNumber?: string
  sender?: {
    name?: string | null
    taxNumber?: string | null
    taxOffice?: string | null
    address?: string | null
    city?: string | null
  }
  customer?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    district?: string
    country?: string
  }
  supplier?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    district?: string
    country?: string
  }
  // SEVK ADRESİ. İki kanaldan birden gider:
  //  1) deliveryCity / deliveryCitySubdivisionName / deliveryCountry — standart alanlar.
  //     Mysoft bunları BUGÜN UBL'e yazmıyor (ölçüldü), yine de gönderiyoruz.
  //  2) additionalDocumentRef "SEVK_ADRESI" — açık adres dahil belgeye fiilen giren yol.
  //     Şablon bu referansı okuyup "Sevk Adresi" satırını basar.
  delivery?: {
    /** Açık adres (cadde/bina/kapı). Yalnız 2. kanaldan gider. */
    address?: string
    city?: string
    district?: string
    country?: string
  }
  items: InvoiceItemData[]
  notes?: string
}

export interface InvoiceItemData {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  productId?: string
  taxExemptionReasonCode?: string
  taxExemptionReason?: string
}

export interface EInvoiceResponse {
  success: boolean
  uuid?: string
  error?: string
  message?: string
}

export interface EInvoiceStatus {
  status: "SENT" | "APPROVED" | "REJECTED" | "CANCELLED" | "PENDING"
  uuid: string
  message?: string
}

export interface IncomingInvoiceParams {
  startDate?: Date
  endDate?: Date
  status?: string
}

export interface IncomingInvoice {
  uuid: string
  invoiceNo: string
  date: Date
  totalAmount: number
  vatAmount: number
  netAmount: number
  status: string
  sender: {
    name: string
    taxNumber: string
  }
}

