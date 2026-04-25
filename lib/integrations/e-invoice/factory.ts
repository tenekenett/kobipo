import { EInvoiceProvider } from "./types"
import { MockEInvoiceProvider } from "./mock"
import { RestEInvoiceProvider } from "./rest-provider"

export function createEInvoiceProvider(providerName?: string): EInvoiceProvider {
  const provider = providerName || process.env.E_INVOICE_PROVIDER || "mock"

  const createRestProvider = (name: string) => {
    const baseUrl = process.env.E_INVOICE_API_BASE_URL
    const apiKey = process.env.E_INVOICE_API_KEY
    if (!baseUrl || !apiKey) {
      return null
    }
    return new RestEInvoiceProvider({ name, baseUrl, apiKey })
  }

  switch (provider.toLowerCase()) {
    case "logo":
      return createRestProvider("Logo") || new MockEInvoiceProvider()
    case "turkcell":
      return createRestProvider("Turkcell") || new MockEInvoiceProvider()
    case "veriban":
      return createRestProvider("Veriban") || new MockEInvoiceProvider()
    case "mock":
    default:
      return new MockEInvoiceProvider()
  }
}

