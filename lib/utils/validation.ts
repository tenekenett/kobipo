/**
 * Form validasyon utility fonksiyonları
 */

export const validators = {
  email: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  },

  taxNumber: (taxNumber: string): boolean => {
    // Türkiye vergi numarası validasyonu (10 veya 11 haneli)
    const cleaned = taxNumber.replace(/\D/g, "")
    return cleaned.length === 10 || cleaned.length === 11
  },

  phone: (phone: string): boolean => {
    // Türkiye telefon numarası validasyonu
    const cleaned = phone.replace(/\D/g, "")
    return cleaned.length === 10 || cleaned.length === 11
  },

  required: (value: any): boolean => {
    if (typeof value === "string") {
      return value.trim().length > 0
    }
    return value !== null && value !== undefined
  },

  minLength: (value: string, min: number): boolean => {
    return value.length >= min
  },

  maxLength: (value: string, max: number): boolean => {
    return value.length <= max
  },

  number: (value: any): boolean => {
    return !isNaN(parseFloat(value)) && isFinite(value)
  },

  positive: (value: number): boolean => {
    return value > 0
  },

  min: (value: number, min: number): boolean => {
    return value >= min
  },

  max: (value: number, max: number): boolean => {
    return value <= max
  },
}

export interface ValidationRule {
  validator: (value: any) => boolean
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export function validate(value: any, rules: ValidationRule[]): ValidationResult {
  const errors: string[] = []

  for (const rule of rules) {
    if (!rule.validator(value)) {
      errors.push(rule.message)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

