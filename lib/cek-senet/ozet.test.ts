/**
 * Duruma göre çek/senet özetinin testleri.
 *
 * Kartlardaki rakam listeyle aynı kaynaktan (istemciye gelen tam liste) kurulur;
 * burada kilitlenen şey yön ayrımı ve Decimal metninin sayıya çevrilmesidir —
 * ikisi de sessizce bozulursa kart "portföyde 120.000 ₺" der, oysa 100.000'i
 * alacak 20.000'i borçtur.
 */

import { describe, expect, it } from "vitest"
import { cekSenetOzeti } from "./ozet"
import { CEK_SENET_STATUSES } from "./labels"

describe("cekSenetOzeti", () => {
  it("boş listede her durum için sıfır satır döner, sıra sabittir", () => {
    const o = cekSenetOzeti([])
    expect(o.byStatus.map((s) => s.status)).toEqual([...CEK_SENET_STATUSES])
    expect(o.byStatus.every((s) => s.count === 0 && s.total === 0)).toBe(true)
    expect(o.all).toEqual({ status: "ALL", count: 0, total: 0, received: 0, given: 0 })
  })

  it("Decimal metnini sayar, alınan/verilen ayrı toplar, kuruşa yuvarlar", () => {
    const o = cekSenetOzeti([
      { amount: "100.10", status: "PORTFÖYDE", direction: "RECEIVED" },
      { amount: "0.20", status: "PORTFÖYDE", direction: null, supplier: null },
      // Yön yok ama tedarikçiye bağlı → verilen (labels.ts kuralı)
      { amount: 50, status: "PORTFÖYDE", direction: null, supplier: { id: "s1" } },
      { amount: 999, status: "TAHSİL_EDİLDİ", direction: "GIVEN" },
    ])
    const portfoy = o.byStatus.find((s) => s.status === "PORTFÖYDE")!
    expect(portfoy).toEqual({ status: "PORTFÖYDE", count: 3, total: 150.3, received: 100.3, given: 50 })
    expect(o.all.count).toBe(4)
    expect(o.all.total).toBe(1149.3)
    expect(o.all.given).toBe(1049)
  })

  it("bilinmeyen durum atlanmaz, listenin sonuna eklenir; sayı olmayan tutar sayılmaz", () => {
    const o = cekSenetOzeti([
      { amount: 10, status: "ESKİ_DURUM" },
      { amount: "abc", status: "PORTFÖYDE" },
    ])
    expect(o.byStatus.at(-1)).toEqual({ status: "ESKİ_DURUM", count: 1, total: 10, received: 10, given: 0 })
    expect(o.byStatus.find((s) => s.status === "PORTFÖYDE")!.count).toBe(0)
    expect(o.all.count).toBe(1)
  })
})
