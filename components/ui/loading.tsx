"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoadingProps {
  className?: string
  size?: "sm" | "md" | "lg"
  text?: string
}

export function Loading({ className, size = "md", text }: LoadingProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  }

  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <Loader2 className={cn("animate-spin", sizeClasses[size])} />
      {text && <span className="text-sm text-muted-foreground">{text}</span>}
    </div>
  )
}

export function LoadingSpinner({ className, size = "md" }: Omit<LoadingProps, "text">) {
  return <Loading className={className} size={size} />
}

export function LoadingPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loading size="lg" text="Yükleniyor..." />
    </div>
  )
}

