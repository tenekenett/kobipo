import { ReactNode } from "react"

export function ResponsiveTable({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>
}
