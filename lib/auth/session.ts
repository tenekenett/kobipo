import { getServerSession } from "next-auth"
import { cache } from "react"
import { authOptions } from "./config"

export const getSession = cache(async function getSession() {
  return await getServerSession(authOptions)
})

export const getCurrentUser = cache(async function getCurrentUser() {
  const session = await getSession()
  return session?.user
})

