import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"

function getKey() {
  const source = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!source) {
    throw new Error("NEXTAUTH_SECRET or AUTH_SECRET must be configured for secret encryption")
  }
  return createHash("sha256").update(source).digest()
}

export function encryptSecret(value: string) {
  if (!value) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`
}

export function decryptSecret(payload: string | null | undefined) {
  if (!payload) return ""
  const [ivHex, tagHex, dataHex] = payload.split(":")
  if (!ivHex || !tagHex || !dataHex) return ""
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ])
  return decrypted.toString("utf8")
}
