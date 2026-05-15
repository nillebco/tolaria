import type { FilterCondition } from '../types'

function toStringValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function conditionList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(toStringValue) : null
}

function textMatchResult(op: FilterCondition['op'], matched: boolean): boolean {
  if (op === 'contains' || op === 'equals') return matched
  if (op === 'not_contains' || op === 'not_equals') return !matched
  return false
}

class PropertyArrayField {
  private readonly values: string[]
  private readonly normalizedValues: Set<string>

  constructor(values: string[]) {
    this.values = values
    this.normalizedValues = new Set(values.map((value) => value.toLowerCase()))
  }

  contains(target: string): boolean {
    return this.normalizedValues.has(target.toLowerCase())
  }

  equals(target: string): boolean {
    return this.values.length === 1 && this.contains(target)
  }

  matchesAny(targets: string[] | null): boolean {
    return targets?.some((target) => this.contains(target)) ?? false
  }

  matchesRegex(regex: RegExp): boolean {
    return this.values.some((value) => regex.test(value))
  }
}

const PROPERTY_ARRAY_OPERATORS = {
  contains: (field, value) => field.contains(value),
  not_contains: (field, value) => !field.contains(value),
  equals: (field, value) => field.equals(value),
  not_equals: (field, value) => !field.equals(value),
  any_of: (field, _value, cond) => field.matchesAny(conditionList(cond.value)),
  none_of: (field, _value, cond) => !field.matchesAny(conditionList(cond.value)),
} satisfies Partial<Record<FilterCondition['op'], (field: PropertyArrayField, value: string, cond: FilterCondition) => boolean>>

export function evaluatePropertyArrayCondition(
  cond: FilterCondition,
  values: string[],
  condVal: string,
  regex: RegExp | null,
): boolean {
  const field = new PropertyArrayField(values)
  if (regex) return textMatchResult(cond.op, field.matchesRegex(regex))
  const operator = PROPERTY_ARRAY_OPERATORS[cond.op as keyof typeof PROPERTY_ARRAY_OPERATORS]
  return operator?.(field, condVal, cond) ?? false
}
