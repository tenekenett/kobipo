"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  NAV_GROUPS,
  NAV_PAGES,
  STANDALONE_NAV_HREFS,
  moduleKeyForPath,
  navPage,
} from "@/lib/nav/pages"
import { useOptionalDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { Eye, Lock, Pencil } from "lucide-react"

/**
 * Sayfa yetkisi seçici — hem ekip üyesinin kişisel kısıtında hem de özel rol
 * tanımında kullanılır. Tek bileşen olması önemli: iki ekranda iki ayrı liste
 * mantığı, "rolde şunu gördüm ama üyede yok" tarzı sessiz tutarsızlık üretirdi.
 *
 * Liste `lib/nav/pages.ts`ten türer; panele eklenen sayfa burada kendiliğinden çıkar.
 */

export type Access = "none" | "view" | "edit"

const MODULE_LABELS = new Map(MANAGEABLE_MODULES.map((m) => [m.key, m.label]))

export function PagePermissionPicker({
  selectableHrefs,
  access,
  onChange,
}: {
  /** Seçilebilecek sayfalar (tavan). Dışındakiler hiç gösterilmez. */
  selectableHrefs: string[]
  access: Record<string, Access>
  onChange: (next: Record<string, Access>) => void
}) {
  // Firma bağlamı İSTEĞE BAĞLI: aynı seçici sistem yönetim panelinde de kullanılıyor
  // (hazır rol kalıpları), orada seçili firma yok — dolayısıyla modül rozeti de yok.
  const selectedCompany = useOptionalDashboardCompany()?.selectedCompany ?? null

  // Firmanın satın almadığı modülün sayfası işaretlenebilir ama açılmaz: modül kapısı
  // izin kapısından önce gelir. Rozetle uyarmazsak "yetki verdim ama görünmüyor" olur.
  const disabledModules = useMemo(
    () => new Set(selectedCompany?.disabledModules ?? []),
    [selectedCompany]
  )
  const closedModuleFor = (href: string) => {
    const key = navPage(href)?.module ?? moduleKeyForPath(href)
    return key && disabledModules.has(key) ? MODULE_LABELS.get(key) ?? key : null
  }

  const groups = useMemo(() => {
    const allow = new Set(selectableHrefs)
    const grouped = NAV_GROUPS.map((group) => ({
      title: group.title,
      hrefs: group.hrefs.filter((href) => allow.has(href) && navPage(href)),
    })).filter((group) => group.hrefs.length > 0)

    // Gruba girmeyen öğeler (Dashboard, Destek, Profil) menüde de ayrı duruyor.
    const inGroups = new Set(NAV_GROUPS.flatMap((g) => g.hrefs))
    const loose = NAV_PAGES.map((p) => p.href).filter(
      (href) => allow.has(href) && (!inGroups.has(href) || STANDALONE_NAV_HREFS.includes(href))
    )
    return loose.length > 0 ? [{ title: "Genel", hrefs: loose }, ...grouped] : grouped
  }, [selectableHrefs])

  const setAll = (value: Access) =>
    onChange(Object.fromEntries(selectableHrefs.map((href) => [href, value])))

  const set = (href: string, value: Access) => onChange({ ...access, [href]: value })

  const selectedCount = selectableHrefs.filter((h) => (access[h] ?? "none") !== "none").length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <span className="text-sm text-muted-foreground">
          {selectedCount}/{selectableHrefs.length} sayfa seçili
        </span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAll("edit")}>
            Hepsi tam
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAll("view")}>
            Hepsi salt okunur
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAll("none")}>
            Hiçbiri
          </Button>
        </div>
      </div>

      {groups.map((group) => {
        const groupSelected = group.hrefs.filter((h) => (access[h] ?? "none") !== "none").length
        return (
          <div key={group.title}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}{" "}
                <span className="font-normal normal-case">
                  ({groupSelected}/{group.hrefs.length})
                </span>
              </h3>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() =>
                    onChange({
                      ...access,
                      ...Object.fromEntries(group.hrefs.map((h) => [h, "edit" as Access])),
                    })
                  }
                >
                  tümü
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() =>
                    onChange({
                      ...access,
                      ...Object.fromEntries(group.hrefs.map((h) => [h, "none" as Access])),
                    })
                  }
                >
                  hiçbiri
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {group.hrefs.map((href) => {
                const current = access[href] ?? "none"
                const closedModule = closedModuleFor(href)
                return (
                  <div
                    key={href}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <label className="flex flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={current !== "none"}
                        onChange={(e) => set(href, e.target.checked ? "view" : "none")}
                      />
                      <span className={closedModule ? "text-muted-foreground" : undefined}>
                        {navPage(href)?.label ?? href}
                      </span>
                      {closedModule && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          title={`${closedModule} modülü satın alınmadığı için bu sayfa yetki verilse de açılmaz.`}
                        >
                          <Lock className="h-3 w-3" />
                          {closedModule} kapalı
                        </span>
                      )}
                    </label>
                    <div className="flex shrink-0 gap-1">
                      <AccessButton
                        active={current === "view"}
                        disabled={current === "none"}
                        onClick={() => set(href, "view")}
                        icon={<Eye className="h-3.5 w-3.5" />}
                        label="Görüntüle"
                      />
                      <AccessButton
                        active={current === "edit"}
                        disabled={current === "none"}
                        onClick={() => set(href, "edit")}
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        label="Düzenle"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AccessButton({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40"
          : active
            ? "border-kobipo-blue bg-kobipo-pale font-medium text-kobipo-blue dark:bg-primary/15 dark:text-primary"
            : "text-muted-foreground hover:bg-muted",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  )
}

/** İzin listelerini seçici durumuna çevirir. */
export function accessFromPaths(
  selectableHrefs: string[],
  allowed: string[],
  writable: string[]
): Record<string, Access> {
  const allowedSet = new Set(allowed)
  const writableSet = new Set(writable)
  return Object.fromEntries(
    selectableHrefs.map((href) => [
      href,
      allowedSet.has(href) ? (writableSet.has(href) ? "edit" : "view") : "none",
    ])
  )
}

/** Seçici durumunu API'ye gidecek iki listeye çevirir. */
export function pathsFromAccess(access: Record<string, Access>) {
  const entries = Object.entries(access)
  return {
    allowedPaths: entries.filter(([, a]) => a !== "none").map(([href]) => href),
    writablePaths: entries.filter(([, a]) => a === "edit").map(([href]) => href),
  }
}
