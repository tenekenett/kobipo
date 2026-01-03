import { EInvoiceProvider } from "./types"
import { MockEInvoiceProvider } from "./mock"

export function createEInvoiceProvider(providerName?: string): EInvoiceProvider {
  const provider = providerName || process.env.E_INVOICE_PROVIDER || "mock"

  switch (provider.toLowerCase()) {
    case "logo":
      // TODO: Implement Logo provider
      return new MockEInvoiceProvider()
    case "turkcell":
      // TODO: Implement Turkcell provider
      return new MockEInvoiceProvider()
    case "veriban":
      // TODO: Implement Veriban provider
      return new MockEInvoiceProvider()
    case "mock":
    default:
      return new MockEInvoiceProvider()
  }
}

