import { DefaultSession, DefaultUser } from "next-auth"
import { JWT, DefaultJWT } from "next-auth/jwt"
import { Role } from "@prisma/client"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      isSuperAdmin: boolean
      defaultCompanyId?: string | null
      defaultRole?: Role | null
    } & DefaultSession["user"]
  }

  interface User extends DefaultUser {
    id: string
    isSuperAdmin?: boolean
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string
    isSuperAdmin?: boolean
    defaultCompanyId?: string | null
    defaultRole?: Role | null
  }
}
