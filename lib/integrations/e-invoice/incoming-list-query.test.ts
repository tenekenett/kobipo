import { describe, expect, it } from "vitest"
import {
  buildIncomingWhere,
  buildIncomingWhereWithoutDate,
  describeIncomingFilters,
  incomingOrderBy,
  parseIncomingListFilters,
  type IncomingListFilters,
} from "./incoming-list-query"

const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-10T00:00:00Z") }

const filtersFrom = (query: string): IncomingListFilters => {
  const parsed = parseIncomingListFilters(new URLSearchParams(query), range)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.filters
}

describe("gelen fatura gizleme süzgeci", () => {
  it("param yoksa gizlenenler HARİÇ — liste, dışa aktarım ve kartların varsayılanı", () => {
    expect(filtersFrom("").hidden).toBe("exclude")
    expect(filtersFrom("hidden=").hidden).toBe("exclude")
    expect(filtersFrom("hidden=bilinmeyen").hidden).toBe("exclude")
    expect(filtersFrom("hidden=only").hidden).toBe("only")
  })

  it("koşul tarihli ve tarihsiz sorguda aynı (boş liste ipucu da gizlenenleri saymasın)", async () => {
    const haric = filtersFrom("")
    const yalniz = filtersFrom("hidden=only")
    for (const build of [buildIncomingWhere, buildIncomingWhereWithoutDate]) {
      expect((await build("firma-1", haric)).AND).toContainEqual({ hiddenAt: null })
      expect((await build("firma-1", yalniz)).AND).toContainEqual({ hiddenAt: { not: null } })
    }
  })

  it("dışa aktarılan belgenin başlığı gizlenenler görünümünü söyler", () => {
    expect(describeIncomingFilters(filtersFrom("hidden=only"))).toContain(
      "Yalnız listede gizlenen faturalar",
    )
    expect(describeIncomingFilters(filtersFrom("")).join(" ")).not.toContain("gizlenen")
  })
})

describe("gelen fatura sıralaması", () => {
  it("son ölçüt benzersiz id — aynı senkronun faturaları sayfalar arasında kaymasın", () => {
    for (const field of ["docDate", "sentDate"] as const) {
      expect(incomingOrderBy(field).at(-1)).toEqual({ id: "desc" })
    }
  })
})
