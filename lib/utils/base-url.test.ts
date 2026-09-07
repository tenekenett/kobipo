import { afterEach, describe, expect, it, vi } from "vitest"
import { appBaseUrl, resolveBaseUrl } from "./base-url"

/** Ortamı temiz bırak: dosyadaki .env değerleri testler arasında sızmasın. */
function clearEnv() {
  for (const key of [
    "NEXT_PUBLIC_APP_URL",
    "NEXTAUTH_URL",
    "AUTH_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ]) {
    vi.stubEnv(key, "")
  }
}

function req(headers: Record<string, string>) {
  return new Request("https://ignored.example/api/x", { headers })
}

afterEach(() => vi.unstubAllEnvs())

describe("appBaseUrl", () => {
  it("ortam değişkenini kullanır", () => {
    clearEnv()
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.kobipo.com/")
    expect(appBaseUrl()).toBe("https://www.kobipo.com")
  })

  it("dağıtıma özgü ortam değerini ATLAR, sıradaki adaya geçer", () => {
    clearEnv()
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://kobipo-ri4t58v21-tenekenets-projects.vercel.app")
    vi.stubEnv("NEXTAUTH_URL", "https://www.kobipo.com")
    expect(appBaseUrl()).toBe("https://www.kobipo.com")
  })

  it("şemasız Vercel değişkenine https ekler", () => {
    clearEnv()
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "panel.kobipo.com")
    expect(appBaseUrl()).toBe("https://panel.kobipo.com")
  })

  it("hiçbir ortam değeri yoksa marka domainine düşer", () => {
    clearEnv()
    expect(appBaseUrl()).toBe("https://www.kobipo.com")
  })
})

describe("resolveBaseUrl", () => {
  it("tarayıcıdan gelen origin'i olduğu gibi kullanır", () => {
    clearEnv()
    expect(resolveBaseUrl(req({ origin: "https://www.kobipo.com/" }))).toBe(
      "https://www.kobipo.com",
    )
  })

  it("önizleme dağıtımında bile origin'e saygı gösterir (ödeme dönüş adresi)", () => {
    clearEnv()
    const origin = "https://kobipo-ri4t58v21-tenekenets-projects.vercel.app"
    expect(resolveBaseUrl(req({ origin }))).toBe(origin)
  })

  it("origin yoksa kanonik host'u kullanır", () => {
    clearEnv()
    expect(resolveBaseUrl(req({ host: "www.kobipo.com" }))).toBe("https://www.kobipo.com")
  })

  it("yerel geliştirme host'unu korur", () => {
    clearEnv()
    expect(
      resolveBaseUrl(req({ host: "localhost:3000", "x-forwarded-proto": "http" })),
    ).toBe("http://localhost:3000")
  })

  // ASIL HATA: Vercel cron uygulamayı dağıtıma özgü adresle çağırıyor; bu adres
  // abonelik uyarısı e-postasına yazılmıştı.
  it("cron'un dağıtıma özgü host'unu kanonik adresle değiştirir", () => {
    clearEnv()
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.kobipo.com")
    expect(
      resolveBaseUrl(req({ host: "kobipo-ri4t58v21-tenekenets-projects.vercel.app" })),
    ).toBe("https://www.kobipo.com")
  })

  it("ortam da yoksa dağıtım host'u yerine marka domainini verir", () => {
    clearEnv()
    expect(resolveBaseUrl(req({ host: "kobipo.vercel.app" }))).toBe("https://www.kobipo.com")
  })
})
