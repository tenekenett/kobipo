// IP/port çözümlemesinin testi.
//
// Bu mantığın sessizce bozulması, defterin YANLIŞ adres yazması demektir — hukuki bir
// kayıtta en kötü sonuç budur (boş kalması daha iyidir). O yüzden header varyasyonları
// tek tek sabitlendi: vekil zinciri, IPv6, port taşıyan/taşımayan biçimler.

import { describe, expect, it } from "vitest"
import { clientInfoFromHeaders } from "./access-log"

describe("clientInfoFromHeaders", () => {
  it("x-forwarded-for zincirinin İLK girdisini alır", () => {
    const info = clientInfoFromHeaders({
      "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178",
    })
    expect(info.ip).toBe("203.0.113.9")
    // Zincirin tamamı saklanır: tek IP kurumsal vekil arkasında yanıltıcı olabilir.
    expect(info.forwardedFor).toBe("203.0.113.9, 70.41.3.18, 150.172.238.178")
  })

  it("cf-connecting-ip zincirin önüne geçer", () => {
    const info = clientInfoFromHeaders({
      "cf-connecting-ip": "198.51.100.7",
      "x-forwarded-for": "203.0.113.9",
    })
    expect(info.ip).toBe("198.51.100.7")
  })

  it("ip:port biçimini ayırır", () => {
    const info = clientInfoFromHeaders({ "x-forwarded-for": "203.0.113.9:51234" })
    expect(info.ip).toBe("203.0.113.9")
    expect(info.port).toBe(51234)
  })

  it("IPv6'yı porta bölmez — köşeli parantez şart", () => {
    const plain = clientInfoFromHeaders({ "x-forwarded-for": "2001:db8::1" })
    expect(plain.ip).toBe("2001:db8::1")
    expect(plain.port).toBeNull()

    const bracketed = clientInfoFromHeaders({ "x-forwarded-for": "[2001:db8::1]:51234" })
    expect(bracketed.ip).toBe("2001:db8::1")
    expect(bracketed.port).toBe(51234)
  })

  it("x-forwarded-port'u istemci portu SANMAZ", () => {
    // O başlık isteğin ulaştığı SUNUCU portudur (443). İstemci portu diye yazmak,
    // defteri okuyan kişiyi yanlış yönlendirir.
    const info = clientInfoFromHeaders({
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-port": "443",
    })
    expect(info.port).toBeNull()
  })

  it("kaynak portunu ayrı taşıyan başlıkları okur", () => {
    expect(clientInfoFromHeaders({ "x-real-ip": "203.0.113.9", "x-client-port": "40911" }).port).toBe(
      40911
    )
    expect(
      clientInfoFromHeaders({ "x-real-ip": "203.0.113.9", "cf-connecting-port": "40912" }).port
    ).toBe(40912)
  })

  it("Headers nesnesiyle de düz sözlükle de çalışır", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "Mozilla/5.0" })
    const info = clientInfoFromHeaders(headers)
    expect(info.ip).toBe("203.0.113.9")
    expect(info.userAgent).toBe("Mozilla/5.0")
  })

  it("hiçbir başlık yoksa uydurmaz", () => {
    const info = clientInfoFromHeaders({})
    expect(info).toEqual({ ip: null, port: null, forwardedFor: null, userAgent: null })
    expect(clientInfoFromHeaders(undefined).ip).toBeNull()
  })
})
