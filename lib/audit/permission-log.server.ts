import { headers } from "next/headers"
import { prisma } from "@/lib/db/prisma"
import { clientInfoFromHeaders } from "@/lib/audit/access-log"
import { pageRuleForApiPath, requiredPagesForApiPath, type PagePermissions } from "@/lib/page-access"
import {
  PAGE_FORBIDDEN_ACTION,
  describeMembershipChange,
  describePageForbidden,
  describeRoleChange,
  type MembershipSnapshot,
  type RoleSnapshot,
} from "./permission-log"

/**
 * Yetki günlüğünün YAZAN yarısı (`system_logs`). Kural: CLAUDE.md → "Yetki değişikliği
 * günlüğe yazılır"; farkı kuran saf taraf `permission-log.ts`.
 *
 * FAIL-OPEN: günlük yazılamazsa asıl iş ENGELLENMEZ, hata konsola yazılır
 * (`lib/audit/access-log.ts` ile aynı karar). Yetki değişikliğini kaydetmek, değişikliği
 * yapabilmekten önemli değil.
 */

const MEMBERSHIP_SNAPSHOT_SELECT = {
  role: true,
  allowedPaths: true,
  writablePaths: true,
  customRole: { select: { id: true, name: true, allowedPaths: true, writablePaths: true } },
} as const

/** Üyeliğin şu anki fotoğrafı; üyelik yoksa `null`. */
export async function readMembershipSnapshot(
  userId: string,
  companyId: string
): Promise<MembershipSnapshot | null> {
  return prisma.userCompany.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: MEMBERSHIP_SNAPSHOT_SELECT,
  })
}

/** Okunamazsa `undefined` (BİLİNMİYOR) — "üyelik yok" sanılıp yanlış kayıt yazılmasın. */
async function snapshotOrUnknown(userId: string, companyId: string) {
  try {
    return await readMembershipSnapshot(userId, companyId)
  } catch (error) {
    console.error("[yetki-gunlugu] üyelik okunamadı:", error)
    return undefined
  }
}

/** İsteği yapanın IP'si ve tarayıcısı; istek dışında (script, cron) boş. */
async function requestOrigin(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const info = clientInfoFromHeaders(await headers())
    return { ipAddress: info.ip, userAgent: info.userAgent }
  } catch {
    return { ipAddress: null, userAgent: null }
  }
}

async function companyLabel(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, branchName: true },
  })
  if (!company) return companyId
  return company.branchName ? `${company.name} / ${company.branchName}` : company.name
}

async function userEmail(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  return user?.email ?? null
}

export type MembershipLogMeta = {
  /** Değişikliği yapan; davet kabulünde üyenin kendisi. */
  actorUserId: string | null
  companyId: string
  memberUserId: string
  /** Değişikliğin yapıldığı yer: "Ekip Yönetimi", "Davet kabulü", "Sistem yönetimi"… */
  via: string
  /** Davetle açılan üyelikte daveti gönderen. */
  invitedByUserId?: string | null
}

export async function logMembershipChange(
  meta: MembershipLogMeta,
  before: MembershipSnapshot | null,
  after: MembershipSnapshot | null
): Promise<void> {
  try {
    const change = describeMembershipChange(before, after)
    if (!change) return
    const [company, member, inviter, origin] = await Promise.all([
      companyLabel(meta.companyId),
      userEmail(meta.memberUserId),
      userEmail(meta.invitedByUserId),
      requestOrigin(),
    ])
    await prisma.systemLog.create({
      data: {
        userId: meta.actorUserId,
        action: change.action,
        entity: "UserCompany",
        entityId: meta.memberUserId,
        level: change.action === "REMOVE_USER_COMPANY" ? "WARN" : "INFO",
        details: [
          `${member ?? meta.memberUserId} · ${company}: ${change.headline}`,
          `Kanal: ${meta.via}`,
          ...(inviter ? [`Davet eden: ${inviter}`] : []),
          ...change.lines,
          `Firma: ${meta.companyId} · Üye: ${meta.memberUserId}`,
        ].join("\n"),
        ...origin,
      },
    })
  } catch (error) {
    console.error("[yetki-gunlugu] üyelik kaydı yazılamadı:", error)
  }
}

/**
 * Üyeliği değiştiren yazmayı sarar: önce/sonra fotoğrafını alır, yazmayı çalıştırır,
 * farkı günlüğe yazar. Yazma hata verirse günlük yazılmaz ve hata AYNEN fırlar.
 * `userCompany` yazan her yol bunu (ya da `logMembershipChange`ı) kullanır —
 * nöbetçi: lib/audit/permission-log-coverage.test.ts.
 */
export async function withMembershipLog<T>(meta: MembershipLogMeta, write: () => Promise<T>): Promise<T> {
  const before = await snapshotOrUnknown(meta.memberUserId, meta.companyId)
  const result = await write()
  const after = await snapshotOrUnknown(meta.memberUserId, meta.companyId)
  if (before !== undefined && after !== undefined) await logMembershipChange(meta, before, after)
  return result
}

/** Özel rolün şu anki fotoğrafı; rol yoksa `null`, okunamazsa `undefined` (BİLİNMİYOR). */
export async function readRoleSnapshot(roleId: string): Promise<RoleSnapshot | null | undefined> {
  try {
    return await prisma.companyRole.findUnique({
      where: { id: roleId },
      select: { name: true, allowedPaths: true, writablePaths: true },
    })
  } catch (error) {
    console.error("[yetki-gunlugu] rol okunamadı:", error)
    return undefined
  }
}

/** `before` BİLİNMİYORSA (`undefined`) kayıt yazılmaz — yanlış "oluşturuldu" yazılmasın. */
export async function logRoleChange(
  meta: { actorUserId: string | null; companyId: string; roleId: string },
  before: RoleSnapshot | null | undefined,
  after: RoleSnapshot | null
): Promise<void> {
  if (before === undefined) return
  try {
    const change = describeRoleChange(before, after)
    if (!change) return
    const [company, members, origin] = await Promise.all([
      companyLabel(meta.companyId),
      // Rolün yetkisi değişince bu rolü taşıyan HERKESİN yetkisi değişir; kimin
      // etkilendiği kayıtta yazmazsa üye geçmişinde bu değişiklik görünmez.
      prisma.userCompany.findMany({
        where: { customRoleId: meta.roleId },
        select: { user: { select: { email: true } } },
      }),
      requestOrigin(),
    ])
    const emails = members.map((m) => m.user?.email).filter(Boolean)
    await prisma.systemLog.create({
      data: {
        userId: meta.actorUserId,
        action: change.action,
        entity: "CompanyRole",
        entityId: meta.roleId,
        level: change.action === "DELETE_COMPANY_ROLE" ? "WARN" : "INFO",
        details: [
          `${company}: ${change.headline}`,
          `Kanal: Rol Yetkileri`,
          ...change.lines,
          `Bu rolü kullanan (${emails.length}): ${emails.length > 0 ? emails.join(", ") : "—"}`,
          `Firma: ${meta.companyId} · Rol: ${meta.roleId}`,
        ].join("\n"),
        ...origin,
      },
    })
  } catch (error) {
    console.error("[yetki-gunlugu] rol kaydı yazılamadı:", error)
  }
}

/** Aynı kullanıcı × firma × kural için en çok bu aralıkta bir kayıt. */
const PAGE_FORBIDDEN_DEDUP_MS = 24 * 60 * 60 * 1000

/**
 * Sayfa kapısının reddi. Arayüz yetkisiz düğmeyi zaten gizlediği için bir ret çoğu
 * zaman bir HATAYA işaret eder: 2026-10-05'te fatura editörünün firma kartı okuması
 * böyle sessizce reddediliyor, fatura MANUAL kaydediliyordu ve iz yoktu. Günde bir
 * kayıtla sınırlı — aynı ekranın tekrar tekrar denemesi günlüğü doldurmasın.
 */
export async function logPageForbidden(input: {
  userId: string
  companyId: string
  companyLabel: string
  roleText: string
  method: string
  pathname: string
  permissions: PagePermissions
}): Promise<void> {
  try {
    const entry = describePageForbidden({
      method: input.method,
      pathname: input.pathname,
      rulePrefix: pageRuleForApiPath(input.pathname)?.prefix ?? null,
      requiredPages: requiredPagesForApiPath(input.pathname, input.method),
      permissions: input.permissions,
      companyLabel: input.companyLabel,
      roleText: input.roleText,
    })
    const seen = await prisma.systemLog.findFirst({
      where: {
        action: PAGE_FORBIDDEN_ACTION,
        userId: input.userId,
        entityId: input.companyId,
        createdAt: { gte: new Date(Date.now() - PAGE_FORBIDDEN_DEDUP_MS) },
        details: { startsWith: entry.dedupPrefix },
      },
      select: { id: true },
    })
    if (seen) return
    await prisma.systemLog.create({
      data: {
        userId: input.userId,
        action: PAGE_FORBIDDEN_ACTION,
        entity: "Company",
        entityId: input.companyId,
        level: "WARN",
        details: entry.details,
        ...(await requestOrigin()),
      },
    })
  } catch (error) {
    console.error("[yetki-gunlugu] ret kaydı yazılamadı:", error)
  }
}
