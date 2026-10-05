// Yetki günlüğünün SAF yarısı: üyeliğin ya da özel rolün önce/sonra fotoğrafından
// okunur bir fark çıkarır. Yazan taraf `permission-log.server.ts`; kural CLAUDE.md →
// "Yetki değişikliği günlüğe yazılır".
//
// NEDEN: 2026-10-05'e kadar Ekip Yönetimi'nden yapılan izin değişikliği hiçbir yere
// yazılmıyordu. Kısıtlanan bir çalışanın e-faturası MANUAL'a düşünce "yetkisi ne zaman,
// kim tarafından, nasıl değişti" sorusunun cevabı yoktu; tarih ancak kestiği
// faturalardan tahmin edilebildi.
//
// Fark ETKİN izinden kurulur (rol tavanı ∩ liste; özel rolde rolün listesi —
// lib/auth/user-context.ts ile aynı çözüm). Ham listeyi yazmak "kısıtsız" ile "tüm
// sayfalar tek tek seçili" farkını, özel rol atamasını ve rol değişikliğinin tavan
// etkisini gizlerdi.

import { roleLabel } from "@/lib/auth/role-labels"
import { ALWAYS_AVAILABLE_PAGES, NAV_GROUPS, NAV_PAGES, navPage } from "@/lib/nav/pages"
import {
  editablePages,
  isRestrictedMembership,
  visiblePages,
  type PagePermissions,
} from "@/lib/page-access"

/** Üyeliğin yetki fotoğrafı (`userCompany` + özel rolü). `null` = üyelik yok. */
export type MembershipSnapshot = {
  role: string
  allowedPaths: string[]
  writablePaths: string[]
  customRole: { id: string; name: string; allowedPaths: string[]; writablePaths: string[] } | null
}

/** Özel rolün (`companyRole`) fotoğrafı. `null` = rol yok. */
export type RoleSnapshot = { name: string; allowedPaths: string[]; writablePaths: string[] }

export type MembershipAction = "ADD_USER_COMPANY" | "UPDATE_USER_COMPANY" | "REMOVE_USER_COMPANY"
export type RoleAction = "CREATE_COMPANY_ROLE" | "UPDATE_COMPANY_ROLE" | "DELETE_COMPANY_ROLE"

/** Sayfa kapısının reddi (bkz. lib/middleware/company.ts). */
export const PAGE_FORBIDDEN_ACTION = "PAGE_FORBIDDEN"

/** Sistem Yönetimi → Loglar ekranının "Yetki değişiklikleri" süzgeci. */
export const PERMISSION_LOG_ACTIONS: string[] = [
  "ADD_USER_COMPANY",
  "UPDATE_USER_COMPANY",
  "REMOVE_USER_COMPANY",
  "CREATE_COMPANY_ROLE",
  "UPDATE_COMPANY_ROLE",
  "DELETE_COMPANY_ROLE",
]

/** Oturum bağlamıyla AYNI çözüm: özel rolde liste rolden gelir (lib/auth/user-context.ts). */
export function membershipPermissions(s: MembershipSnapshot): PagePermissions {
  return {
    role: s.role,
    allowedPaths: s.customRole?.allowedPaths ?? s.allowedPaths,
    writablePaths: s.customRole?.writablePaths ?? s.writablePaths,
    custom: Boolean(s.customRole),
  }
}

export function rolePermissions(r: RoleSnapshot): PagePermissions {
  return { role: "CUSTOM", allowedPaths: r.allowedPaths, writablePaths: r.writablePaths, custom: true }
}

/** "Yönetici" ya da "Özel rol «Muhasebe Asistanı»". */
export function membershipRoleText(role: string, customRoleName: string | null | undefined): string {
  return customRoleName ? `Özel rol «${customRoleName}»` : roleLabel(role)
}

type Access = "edit" | "view"

/**
 * Etkin izin: sayfa → düzenle/görüntüle, menü sırasıyla. Profil ve destek herkese açık
 * kişisel sayfalardır; farka girselerdi her kayıtta gürültü olurlardı.
 */
function accessMap(p: PagePermissions | null): Map<string, Access> {
  const map = new Map<string, Access>()
  if (!p) return map
  const editable = new Set(editablePages(p))
  for (const href of visiblePages(p)) {
    if (ALWAYS_AVAILABLE_PAGES.includes(href)) continue
    map.set(href, editable.has(href) ? "edit" : "view")
  }
  return map
}

const GROUP_OF = new Map(NAV_GROUPS.flatMap((g) => g.hrefs.map((href) => [href, g.title] as const)))
const LABEL_USES = NAV_PAGES.reduce(
  (uses, p) => uses.set(p.label, (uses.get(p.label) ?? 0) + 1),
  new Map<string, number>()
)

/** Menü etiketi; iki menüde aynı adı taşıyan sayfaya grubu eklenir: "Belge Şablonları (Personel)". */
export function pageLabel(href: string): string {
  const label = navPage(href)?.label ?? href
  const group = GROUP_OF.get(href)
  return (LABEL_USES.get(label) ?? 0) > 1 && group ? `${label} (${group})` : label
}

function labels(hrefs: string[]): string {
  return hrefs.length > 0 ? hrefs.map(pageLabel).join(", ") : "—"
}

export type PermissionDiff = {
  /** Görünürlüğünü yitiren sayfalar. */
  removed: string[]
  /** Yeni görünen sayfalar ve verilen erişim. */
  added: Array<{ href: string; access: Access }>
  /** Görünür kalan ama düzenlemesi kapanan sayfalar. */
  toReadOnly: string[]
  /** Görünür kalan ve düzenlemesi açılan sayfalar. */
  toEdit: string[]
}

export function diffPermissions(before: PagePermissions | null, after: PagePermissions | null): PermissionDiff {
  const a = accessMap(before)
  const b = accessMap(after)
  return {
    removed: [...a.keys()].filter((href) => !b.has(href)),
    added: [...b].filter(([href]) => !a.has(href)).map(([href, access]) => ({ href, access })),
    toReadOnly: [...a].filter(([href, x]) => x === "edit" && b.get(href) === "view").map(([href]) => href),
    toEdit: [...a].filter(([href, x]) => x === "view" && b.get(href) === "edit").map(([href]) => href),
  }
}

function diffCounts(d: PermissionDiff): string[] {
  return [
    d.removed.length > 0 && `kaldırılan ${d.removed.length}`,
    d.added.length > 0 && `eklenen ${d.added.length}`,
    d.toReadOnly.length > 0 && `salt okunura düşen ${d.toReadOnly.length}`,
    d.toEdit.length > 0 && `düzenlemeye açılan ${d.toEdit.length}`,
  ].filter((part): part is string => Boolean(part))
}

function diffLines(d: PermissionDiff): string[] {
  const lines: string[] = []
  if (d.removed.length > 0) lines.push(`Kaldırılan (${d.removed.length}): ${labels(d.removed)}`)
  if (d.added.length > 0) {
    const items = d.added.map((x) => `${pageLabel(x.href)} [${x.access === "edit" ? "Düzenle" : "Görüntüle"}]`)
    lines.push(`Eklenen (${d.added.length}): ${items.join(", ")}`)
  }
  if (d.toReadOnly.length > 0) lines.push(`Salt okunura düşen (${d.toReadOnly.length}): ${labels(d.toReadOnly)}`)
  if (d.toEdit.length > 0) lines.push(`Düzenlemeye açılan (${d.toEdit.length}): ${labels(d.toEdit)}`)
  return lines
}

/** Sayfa listesi: "25 sayfa · Düzenle (24): … · Görüntüle (1): …". */
function describePages(p: PagePermissions): string {
  const map = accessMap(p)
  const edit = [...map].filter(([, a]) => a === "edit").map(([href]) => href)
  const view = [...map].filter(([, a]) => a === "view").map(([href]) => href)
  return `${map.size} sayfa · Düzenle (${edit.length}): ${labels(edit)} · Görüntüle (${view.length}): ${labels(view)}`
}

/** Üyeliğin etkin izni tek satırda. Kısıtsız üyelikte liste basılmaz: rolün tamamıdır. */
export function describeAccess(p: PagePermissions | null): string {
  if (!p) return "üyelik yok"
  if (!isRestrictedMembership(p)) {
    const size = accessMap(p).size
    return `kısıtsız — rolün tüm sayfaları (${size}${editablePages(p).length === 0 ? ", salt okunur" : ""})`
  }
  return `kısıtlı — ${describePages(p)}`
}

function restrictionText(p: PagePermissions): string {
  return `${isRestrictedMembership(p) ? "kısıtlı" : "kısıtsız"}, ${accessMap(p).size} sayfa`
}

export type LogEntry<A extends string> = { action: A; headline: string; lines: string[] }

/** Üyelik farkı; hiçbir şey değişmediyse `null` (günlüğe yazılmaz). */
export function describeMembershipChange(
  before: MembershipSnapshot | null,
  after: MembershipSnapshot | null
): LogEntry<MembershipAction> | null {
  if (!before && !after) return null
  const pb = before ? membershipPermissions(before) : null
  const pa = after ? membershipPermissions(after) : null
  const roleBefore = before ? membershipRoleText(before.role, before.customRole?.name) : null
  const roleAfter = after ? membershipRoleText(after.role, after.customRole?.name) : null

  if (!pb && pa) {
    return {
      action: "ADD_USER_COMPANY",
      headline: `Üyelik açıldı — ${roleAfter}, ${restrictionText(pa)}`,
      lines: [`Rol: ${roleAfter}`, `Sonra: ${describeAccess(pa)}`],
    }
  }
  if (pb && !pa) {
    return {
      action: "REMOVE_USER_COMPANY",
      headline: `Üyelik kaldırıldı — ${roleBefore}, ${restrictionText(pb)}`,
      lines: [`Rol: ${roleBefore}`, `Önce: ${describeAccess(pb)}`],
    }
  }

  const diff = diffPermissions(pb, pa)
  const roleChanged = roleBefore !== roleAfter
  const restrictionChanged = isRestrictedMembership(pb!) !== isRestrictedMembership(pa!)
  const counts = diffCounts(diff)
  if (!roleChanged && !restrictionChanged && counts.length === 0) return null

  const parts = [
    roleChanged && `${roleBefore} → ${roleAfter}`,
    ...counts,
    restrictionChanged && counts.length === 0 && `kısıt: ${isRestrictedMembership(pa!) ? "yok → var" : "var → yok"}`,
  ].filter((part): part is string => Boolean(part))
  return {
    action: "UPDATE_USER_COMPANY",
    headline: `Yetki değişti — ${parts.join(", ")}`,
    lines: [
      `Rol: ${roleChanged ? `${roleBefore} → ${roleAfter}` : roleAfter}`,
      `Önce: ${describeAccess(pb)}`,
      `Sonra: ${describeAccess(pa)}`,
      ...diffLines(diff),
    ],
  }
}

/** Özel rol farkı; hiçbir şey değişmediyse `null`. */
export function describeRoleChange(
  before: RoleSnapshot | null,
  after: RoleSnapshot | null
): LogEntry<RoleAction> | null {
  if (!before && !after) return null
  if (!before && after) {
    return {
      action: "CREATE_COMPANY_ROLE",
      headline: `Özel rol oluşturuldu «${after.name}» — ${accessMap(rolePermissions(after)).size} sayfa`,
      lines: [`Sayfalar: ${describePages(rolePermissions(after))}`],
    }
  }
  if (before && !after) {
    return {
      action: "DELETE_COMPANY_ROLE",
      headline: `Özel rol silindi «${before.name}»`,
      lines: [`Önce: ${describePages(rolePermissions(before))}`],
    }
  }

  const diff = diffPermissions(rolePermissions(before!), rolePermissions(after!))
  const renamed = before!.name !== after!.name
  const counts = diffCounts(diff)
  if (!renamed && counts.length === 0) return null
  const parts = [renamed && `ad «${before!.name}» → «${after!.name}»`, ...counts].filter(
    (part): part is string => Boolean(part)
  )
  return {
    action: "UPDATE_COMPANY_ROLE",
    headline: `Özel rol güncellendi «${after!.name}» — ${parts.join(", ")}`,
    lines: [
      `Önce: ${describePages(rolePermissions(before!))}`,
      `Sonra: ${describePages(rolePermissions(after!))}`,
      ...diffLines(diff),
    ],
  }
}

/**
 * Sayfa kapısı reddinin kaydı. `dedupPrefix` kaydın İLK satırının başıdır: aynı kullanıcı ×
 * firma × kural için günde bir kayıt yazılsın diye yazan taraf bununla arar. Kural ön eki
 * kullanılır, istek yolu değil — yol firma/belge id'si taşır ve her istekte farklıdır.
 */
export function describePageForbidden(input: {
  method: string
  pathname: string
  rulePrefix: string | null
  requiredPages: string[]
  permissions: PagePermissions
  companyLabel: string
  roleText: string
}): { dedupPrefix: string; details: string } {
  const method = input.method.toUpperCase()
  const dedupPrefix = `${method} ${input.rulePrefix ?? input.pathname} — `
  const lines = [
    `${dedupPrefix}reddedildi · ${input.companyLabel}`,
    `İstek: ${method} ${input.pathname}`,
    input.requiredPages.length > 0
      ? `Gereken sayfalardan biri: ${labels(input.requiredPages)}`
      : "Kuralı olmayan uçta yazma kapalı (bkz. PAGE_API_RULES)",
    `Üyelik: ${input.roleText} — ${describeAccess(input.permissions)}`,
  ]
  return { dedupPrefix, details: lines.join("\n") }
}
