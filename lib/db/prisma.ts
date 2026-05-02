import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * On Vercel serverless, each function instance runs a single concurrent request,
 * so connection_limit=1 is the right default when going through pgbouncer
 * (transaction mode). This avoids opening 5+ idle pool connections per cold
 * start. We append the param if the URL doesn't already specify it.
 */
function ensureConnectionLimit(url: string): string {
  if (!process.env.VERCEL) return url
  if (/[?&]connection_limit=/i.test(url)) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}connection_limit=1`
}

/**
 * Supabase shared pooler typically expects:
 * - Runtime traffic on transaction pooler port 6543
 * - pgbouncer=true and connection_limit query params for Prisma
 *
 * If DATABASE_URL is accidentally set to shared pooler :5432, we normalize it
 * at runtime to reduce "Can't reach database server" incidents.
 */
function normalizeSupabasePoolerUrl(url: string): string {
  let normalized = url
  if (normalized.includes('.pooler.supabase.com:5432/')) {
    normalized = normalized.replace('.pooler.supabase.com:5432/', '.pooler.supabase.com:6543/')
  }
  if (/\.pooler\.supabase\.com:6543\//i.test(normalized) && !/[?&]pgbouncer=/i.test(normalized)) {
    const separator = normalized.includes('?') ? '&' : '?'
    normalized = `${normalized}${separator}pgbouncer=true`
  }
  return normalized
}

function createPrismaClient() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL is not set')
  }
  const url = ensureConnectionLimit(normalizeSupabasePoolerUrl(raw))
  return new PrismaClient({
    datasources: {
      db: { url },
    },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

