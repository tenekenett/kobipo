import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        try {
          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email
            },
            select: {
              id: true,
              email: true,
              name: true,
              isSuperAdmin: true,
              password: true,
            },
          })

          if (!user || !user.password) {
            return null
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            isSuperAdmin: user.isSuperAdmin,
          }
        } catch (error) {
          console.error("Auth error:", error)
          return null
        }
      }
    })
  ],
  pages: {
    signIn: "/signin",
    signOut: "/",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.isSuperAdmin = (user as { isSuperAdmin?: boolean }).isSuperAdmin || false

        try {
          const userCompany = await prisma.userCompany.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: "asc" },
            select: { companyId: true, role: true },
          })
          token.defaultCompanyId = userCompany?.companyId ?? null
          token.defaultRole = userCompany?.role ?? null
        } catch (error) {
          console.error("jwt: defaultCompanyId lookup failed", error)
          token.defaultCompanyId = null
          token.defaultRole = null
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.isSuperAdmin = token.isSuperAdmin as boolean
        session.user.defaultCompanyId = (token.defaultCompanyId ?? null) as string | null
        session.user.defaultRole = (token.defaultRole ?? null) as typeof token.defaultRole
      }
      return session
    },
  },
  // Vercel: set NEXTAUTH_SECRET or AUTH_SECRET in Project → Settings → Environment Variables
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
}

