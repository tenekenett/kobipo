"use client"

import { signOut } from "next-auth/react"

export function SuspendedLogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/signin" })}
      className="mt-6 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
    >
      Çıkış Yap
    </button>
  )
}
