import { describe, expect, it } from "vitest"
import {
  DEFAULT_CLASSIFICATION_LABELS,
  normalizeClassificationLabel,
  resolveClassificationLabels,
} from "./classification-labels"

describe("sınıflandırma ekseni etiketleri", () => {
  it("firma adı vermediyse varsayılana düşer", () => {
    expect(resolveClassificationLabels(null)).toEqual(DEFAULT_CLASSIFICATION_LABELS)
    expect(resolveClassificationLabels({})).toEqual(DEFAULT_CLASSIFICATION_LABELS)
    // Sadece boşluktan ibaret ad kaydedilmiş olabilir; o da varsayılan sayılır.
    expect(resolveClassificationLabels({ classification1Label: "   " }).class1).toBe("Sınıflandırma 1")
  })

  it("firma adı verdiyse onu kullanır", () => {
    expect(
      resolveClassificationLabels({ classification1Label: "Müşteri Tipi", classification2Label: "Bölge" })
    ).toEqual({ class1: "Müşteri Tipi", class2: "Bölge" })
  })

  it("kaydedilecek değeri normalize eder", () => {
    expect(normalizeClassificationLabel("  Bölge  ")).toBe("Bölge")
    expect(normalizeClassificationLabel("")).toBeNull()
    expect(normalizeClassificationLabel("   ")).toBeNull()
    expect(normalizeClassificationLabel(42)).toBeNull()
    expect(normalizeClassificationLabel("x".repeat(80))).toHaveLength(60)
  })
})
