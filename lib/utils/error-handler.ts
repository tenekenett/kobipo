/**
 * Error handling utility fonksiyonları
 */

export interface ApiError {
  message: string
  code?: string
  status?: number
}

export function parseError(error: any): ApiError {
  if (error instanceof Error) {
    return {
      message: error.message,
    }
  }

  if (typeof error === "string") {
    return {
      message: error,
    }
  }

  if (error?.response?.data) {
    return {
      message: error.response.data.error || error.response.data.message || "Bir hata oluştu",
      status: error.response.status,
    }
  }

  return {
    message: error?.message || "Beklenmeyen bir hata oluştu",
  }
}

export async function handleApiError(response: Response): Promise<never> {
  let errorMessage = "Bir hata oluştu"

  try {
    const data = await response.json()
    errorMessage = data.error || data.message || errorMessage
  } catch {
    errorMessage = `HTTP ${response.status}: ${response.statusText}`
  }

  throw new Error(errorMessage)
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "Beklenmeyen bir hata oluştu"
}

