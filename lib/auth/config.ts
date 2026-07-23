import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"
import { verifyRecaptcha } from "@/lib/auth/recaptcha"
import { getRequestIp, isLoginLocked, recordLoginFailure, clearLoginFailures } from "@/lib/auth/login-rate-limit"

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        captchaToken: { label: "Captcha", type: "text" },
        signupToken: { label: "Signup Token", type: "text" }
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Brute-force lockout (DB, IP bazlı). FAIL-OPEN: rate-limit katmanı hata verirse
        // giriş ENGELLENMEZ (bkz. login-rate-limit.ts). Kilitliyse şifre bile kontrol edilmez.
        const ip = getRequestIp(req?.headers)
        if (await isLoginLocked(ip)) {
          // Kilitliyken şifre kontrol EDİLMEZ; generic null döneriz (kilit NextAuth yanıtında
          // kendini belli etmez). Kullanıcıya görünür "çok fazla deneme" mesajını signin ekranı
          // ayrı bir uçtan (/api/auth/lock-status) alır.
          return null
        }

        // Kayıt sonrası otomatik giriş: signup'ta üretilen tek kullanımlık jeton
        // geçerliyse captcha atlanır (kullanıcı zaten signup'ta captcha'dan geçti).
        // Jeton tek kullanımlık ve kısa ömürlüdür; şifre yine de doğrulanır.
        let captchaBypass = false
        if (credentials.signupToken) {
          const vt = await prisma.verificationToken.findFirst({
            where: {
              identifier: credentials.email,
              token: credentials.signupToken,
              expires: { gt: new Date() },
            },
          })
          if (vt) {
            captchaBypass = true
            await prisma.verificationToken.delete({ where: { token: vt.token } }).catch(() => {})
          }
        }

        // Bot koruması: reCAPTCHA doğrulaması (anahtar tanımlıysa zorunlu).
        if (!captchaBypass) {
          const captchaOk = await verifyRecaptcha(credentials.captchaToken)
          if (!captchaOk) {
            await recordLoginFailure(ip, credentials.email)
            return null
          }
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
              isBlogEditor: true,
              password: true,
            },
          })

          if (!user || !user.password) {
            await recordLoginFailure(ip, credentials.email)
            return null
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            await recordLoginFailure(ip, credentials.email)
            return null
          }

          // Başarılı giriş: bu IP'nin başarısız-deneme sayacını sıfırla.
          await clearLoginFailures(ip)

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            isSuperAdmin: user.isSuperAdmin,
            isBlogEditor: user.isBlogEditor,
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
    signOut: "/signin",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.isSuperAdmin = (user as { isSuperAdmin?: boolean }).isSuperAdmin || false
        token.isBlogEditor = (user as { isBlogEditor?: boolean }).isBlogEditor || false

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
        session.user.isBlogEditor = token.isBlogEditor as boolean
        session.user.defaultCompanyId = (token.defaultCompanyId ?? null) as string | null
        session.user.defaultRole = (token.defaultRole ?? null) as typeof token.defaultRole
      }
      return session
    },
  },
  // Vercel: set NEXTAUTH_SECRET or AUTH_SECRET in Project → Settings → Environment Variables
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
}

