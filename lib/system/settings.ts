import { prisma } from "@/lib/db/prisma"

// Platform geneli ayarların şeması, tipleri ve varsayılan değerleri.
// Tüm değerler DB'de string olarak saklanır; burada parse edilir.

export interface SystemSettings {
  platformName: string
  supportEmail: string
  maintenanceMode: boolean
  require2FA: boolean
  ipRestriction: boolean
  sessionTimeoutMinutes: number
  emailNotifications: boolean
  newCompanyNotification: boolean
  errorNotification: boolean
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  platformName: "Kobipo",
  supportEmail: "destek@kobipo.com",
  maintenanceMode: false,
  require2FA: false,
  ipRestriction: false,
  sessionTimeoutMinutes: 60,
  emailNotifications: true,
  newCompanyNotification: true,
  errorNotification: true,
}

const BOOLEAN_KEYS: (keyof SystemSettings)[] = [
  "maintenanceMode",
  "require2FA",
  "ipRestriction",
  "emailNotifications",
  "newCompanyNotification",
  "errorNotification",
]

const NUMBER_KEYS: (keyof SystemSettings)[] = ["sessionTimeoutMinutes"]

function parseValue(key: keyof SystemSettings, raw: string): SystemSettings[keyof SystemSettings] {
  if (BOOLEAN_KEYS.includes(key)) return raw === "true"
  if (NUMBER_KEYS.includes(key)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : DEFAULT_SYSTEM_SETTINGS[key]
  }
  return raw
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const rows = await prisma.systemSetting.findMany()
  const result: SystemSettings = { ...DEFAULT_SYSTEM_SETTINGS }
  for (const row of rows) {
    if (row.key in result && row.value !== null) {
      // @ts-expect-error - dinamik key ataması
      result[row.key] = parseValue(row.key as keyof SystemSettings, row.value)
    }
  }
  return result
}

// Gelen kısmi/ham payload'u doğrular ve normalize eder.
export function normalizeSettings(input: Record<string, unknown>): Partial<SystemSettings> {
  const out: Partial<SystemSettings> = {}

  if (typeof input.platformName === "string") out.platformName = input.platformName.trim().slice(0, 120)
  if (typeof input.supportEmail === "string") out.supportEmail = input.supportEmail.trim().slice(0, 200)

  for (const key of BOOLEAN_KEYS) {
    if (input[key] !== undefined) out[key] = Boolean(input[key]) as never
  }

  if (input.sessionTimeoutMinutes !== undefined) {
    const n = Math.round(Number(input.sessionTimeoutMinutes))
    if (Number.isFinite(n)) out.sessionTimeoutMinutes = Math.min(Math.max(n, 5), 1440)
  }

  return out
}

export async function saveSystemSettings(settings: Partial<SystemSettings>): Promise<void> {
  const entries = Object.entries(settings)
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      })
    )
  )
}
