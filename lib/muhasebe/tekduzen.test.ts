// Tekdüzen hesap planı verisi (tekduzen.ts).

import { describe, expect, it } from "vitest"
import { TEKDUZEN_HESAP_PLANI, normalBakiye, tekduzenHesabi, ustKod } from "./tekduzen"

describe("Tekdüzen hesap planı", () => {
  it("kodlar benzersiz ve her hesabın üst düzeyi planda var", () => {
    const kodlar = TEKDUZEN_HESAP_PLANI.map((h) => h.kod)
    expect(new Set(kodlar).size).toBe(kodlar.length)
    for (const h of TEKDUZEN_HESAP_PLANI) {
      expect(h.kod).toMatch(/^[1-7]\d{0,2}$/)
      const ust = ustKod(h.kod)
      if (ust) expect(tekduzenHesabi(ust), `${h.kod} → ${ust}`).toBeDefined()
    }
  })

  it("muhasebe motorunun kullandığı hesaplar planda var", () => {
    for (const kod of ["100", "101", "102", "120", "153", "191", "320", "335", "360", "361", "391", "600", "601", "610", "649", "659", "740", "760", "770"]) {
      expect(tekduzenHesabi(kod), kod).toBeDefined()
    }
  })

  it("normal bakiye yönü: varlık/gider borç, kaynak/gelir alacak, düzenleyici ters", () => {
    const yon = (kod: string) => normalBakiye(tekduzenHesabi(kod)!)
    expect(yon("100")).toBe("B")
    expect(yon("120")).toBe("B")
    expect(yon("191")).toBe("B")
    expect(yon("770")).toBe("B")
    expect(yon("320")).toBe("A")
    expect(yon("391")).toBe("A")
    expect(yon("500")).toBe("A")
    expect(yon("600")).toBe("A")
    expect(yon("649")).toBe("A")
    // Düzenleyiciler.
    expect(yon("103")).toBe("A")
    expect(yon("257")).toBe("A")
    expect(yon("501")).toBe("B")
    expect(yon("580")).toBe("B")
    // 6. sınıfta "(-)" gelirden düşülür, borç bakiyelidir — çift dönmez.
    expect(yon("610")).toBe("B")
    expect(yon("621")).toBe("B")
    expect(yon("659")).toBe("B")
  })
})
