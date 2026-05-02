import { cache } from "react"
import { Role } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { getSession } from "@/lib/auth/session"

export interface UserCompanyContext {
  companyId: string
  companyName: string
  role: Role
  isActive: boolean
  isEDonusumEnabled: boolean
  createdAt: Date
}

export interface UserContext {
  userId: string
  email: string
  name: string | null
  isSuperAdmin: boolean
  companies: UserCompanyContext[]
}

export const getUserContext = cache(async function getUserContext(): Promise<UserContext | null> {
  const session = await getSession()

  if (!session?.user?.email) {
    return null
  }

  let user: {
    id: string
    email: string
    name: string | null
    isSuperAdmin: boolean
    companies: Array<{
      role: Role
      createdAt: Date
      company: {
        id: string
        name: string
        isActive: boolean
        isEDonusumEnabled: boolean
      }
    }>
  } | null = null

  try {
    user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        companies: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            createdAt: true,
            company: {
              select: {
                id: true,
                name: true,
                isActive: true,
                isEDonusumEnabled: true,
              },
            },
          },
        },
      },
    })
  } catch (error) {
    console.error("getUserContext DB error:", error)
    return null
  }

  if (!user) {
    return null
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    companies: user.companies.map((entry) => ({
      companyId: entry.company.id,
      companyName: entry.company.name,
      role: entry.role,
      isActive: entry.company.isActive,
      isEDonusumEnabled: entry.company.isEDonusumEnabled,
      createdAt: entry.createdAt,
    })),
  }
})
