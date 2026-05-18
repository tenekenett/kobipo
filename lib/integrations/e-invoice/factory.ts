import { EInvoiceProvider } from "./types"
import { MockEInvoiceProvider } from "./mock"
import { RestEInvoiceProvider } from "./rest-provider"
import { MysoftEInvoiceProvider } from "./mysoft-provider" // Yeni ekledik

export interface ProviderConfig {
  providerName?: string;
  username?: string;
  passwordText?: string;
  apiUrl?: string;
  vknTckn?: string;
}

export function createEInvoiceProvider(config?: ProviderConfig): EInvoiceProvider {
  const provider = config?.providerName || "mock"

  switch (provider.toLowerCase()) {
    case "mysoft":
      if (!config?.username || !config?.passwordText) {
         console.warn("Mysoft bilgileri eksik, Mock provider'a düşüldü.");
         return new MockEInvoiceProvider();
      }
      return new MysoftEInvoiceProvider({
         username: config.username,
         passwordText: config.passwordText,
         baseUrl: config.apiUrl,
         vknTckn: config.vknTckn,
      });
      
    // Diğer entegratörlerin kodları (İleride onları da güncellersin)
    case "logo":
    case "turkcell":
    case "veriban":
    case "mock":
    default:
      return new MockEInvoiceProvider()
  }
}