import type { VaultPropertyValue } from '../types'

type FormulaValue = string | number | boolean | null
type FormulaFieldResolver = (field: string) => VaultPropertyValue | undefined
type Token =
  | { type: 'identifier'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' }

function formatPropertyValue(value: VaultPropertyValue | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}

function numberValue(value: VaultPropertyValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function formulaNumber(value: FormulaValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function applyArithmetic(left: FormulaValue, right: FormulaValue, operator: string): number {
  const leftNumber = formulaNumber(left)
  const rightNumber = formulaNumber(right)
  if (leftNumber === null || rightNumber === null) throw new Error('Expected number')
  if (operator === '+') return leftNumber + rightNumber
  if (operator === '-') return leftNumber - rightNumber
  if (operator === '*') return leftNumber * rightNumber
  if (rightNumber === 0) throw new Error('Division by zero')
  return leftNumber / rightNumber
}

function compareFormulaValues(left: FormulaValue, right: FormulaValue, operator: string): boolean {
  const leftNumber = formulaNumber(left)
  const rightNumber = formulaNumber(right)
  const comparison = leftNumber !== null && rightNumber !== null
    ? leftNumber - rightNumber
    : String(left ?? '').localeCompare(String(right ?? ''))
  if (operator === '==') return comparison === 0
  if (operator === '!=') return comparison !== 0
  if (operator === '<') return comparison < 0
  if (operator === '<=') return comparison <= 0
  if (operator === '>') return comparison > 0
  return comparison >= 0
}

function truthyFormulaValue(value: FormulaValue): boolean {
  if (value === null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return value.trim().length > 0
}

function formatFormulaResult(value: FormulaValue): string {
  if (value === null) return ''
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
  return String(value)
}

class FormulaParser {
  private index = 0
  private readonly tokens: Token[]
  private readonly resolveField: FormulaFieldResolver

  constructor(tokens: Token[], resolveField: FormulaFieldResolver) {
    this.tokens = tokens
    this.resolveField = resolveField
  }

  parse(): FormulaValue {
    const value = this.parseComparison()
    if (!this.isDone()) throw new Error('Unexpected token')
    return value
  }

  private parseComparison(): FormulaValue {
    let left = this.parseAdditive()
    while (this.matchOperator('==') || this.matchOperator('!=') || this.matchOperator('<') || this.matchOperator('<=') || this.matchOperator('>') || this.matchOperator('>=')) {
      const operator = String(this.previous().value)
      const right = this.parseAdditive()
      left = compareFormulaValues(left, right, operator)
    }
    return left
  }

  private parseAdditive(): FormulaValue {
    let left = this.parseMultiplicative()
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = String(this.previous().value)
      const right = this.parseMultiplicative()
      left = applyArithmetic(left, right, operator)
    }
    return left
  }

  private parseMultiplicative(): FormulaValue {
    let left = this.parseUnary()
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const operator = String(this.previous().value)
      const right = this.parseUnary()
      left = applyArithmetic(left, right, operator)
    }
    return left
  }

  private parseUnary(): FormulaValue {
    if (this.matchOperator('-')) {
      const value = formulaNumber(this.parseUnary())
      if (value === null) throw new Error('Expected number')
      return -value
    }
    return this.parsePrimary()
  }

  private parsePrimary(): FormulaValue {
    const token = this.advance()
    if (!token) throw new Error('Expected value')
    if (token.type === 'number' || token.type === 'string') return token.value
    if (token.type === 'identifier') {
      if (token.value.toLowerCase() === 'if' && this.matchParen('(')) return this.parseIfFunction()
      if (token.value.toLowerCase() === 'true') return true
      if (token.value.toLowerCase() === 'false') return false
      const rawValue = this.resolveField(token.value)
      return numberValue(rawValue) ?? formatPropertyValue(rawValue)
    }
    if (token.type === 'paren' && token.value === '(') {
      const value = this.parseComparison()
      if (!this.matchParen(')')) throw new Error('Expected )')
      return value
    }
    throw new Error('Expected value')
  }

  private parseIfFunction(): FormulaValue {
    const condition = this.parseComparison()
    if (!this.matchComma()) throw new Error('Expected comma')
    const whenTrue = this.parseComparison()
    if (!this.matchComma()) throw new Error('Expected comma')
    const whenFalse = this.parseComparison()
    if (!this.matchParen(')')) throw new Error('Expected )')
    return truthyFormulaValue(condition) ? whenTrue : whenFalse
  }

  private matchOperator(value: string): boolean {
    return this.match((token) => token.type === 'operator' && token.value === value)
  }

  private matchParen(value: '(' | ')'): boolean {
    return this.match((token) => token.type === 'paren' && token.value === value)
  }

  private matchComma(): boolean {
    return this.match((token) => token.type === 'comma')
  }

  private match(predicate: (token: Token) => boolean): boolean {
    const token = this.peek()
    if (!token || !predicate(token)) return false
    this.index += 1
    return true
  }

  private advance(): Token | null {
    const token = this.peek()
    if (token) this.index += 1
    return token
  }

  private previous(): Extract<Token, { type: 'identifier' | 'number' | 'string' | 'operator' | 'paren' }> {
    const token = this.tokens[this.index - 1]
    if (!token || !('value' in token)) throw new Error('Expected previous token')
    return token
  }

  private peek(): Token | null {
    return this.tokens[this.index] ?? null
  }

  private isDone(): boolean {
    return this.index >= this.tokens.length
  }
}

function tokenizeFormula(formula: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < formula.length) {
    const char = formula[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      index += 1
      while (index < formula.length && formula[index] !== quote) {
        value += formula[index]
        index += 1
      }
      if (formula[index] !== quote) throw new Error('Unterminated string')
      tokens.push({ type: 'string', value })
      index += 1
      continue
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(formula[index + 1] ?? ''))) {
      const start = index
      index += 1
      while (index < formula.length && /[\d.]/.test(formula[index])) index += 1
      const value = Number(formula.slice(start, index))
      if (!Number.isFinite(value)) throw new Error('Invalid number')
      tokens.push({ type: 'number', value })
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index
      index += 1
      while (index < formula.length && /[A-Za-z0-9_ -]/.test(formula[index])) index += 1
      tokens.push({ type: 'identifier', value: formula.slice(start, index).trim() })
      continue
    }
    const twoChar = formula.slice(index, index + 2)
    if (['==', '!=', '<=', '>='].includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar })
      index += 2
      continue
    }
    if (['+', '-', '*', '/', '<', '>'].includes(char)) {
      tokens.push({ type: 'operator', value: char })
      index += 1
      continue
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char })
      index += 1
      continue
    }
    if (char === ',') {
      tokens.push({ type: 'comma' })
      index += 1
      continue
    }
    throw new Error('Invalid character')
  }
  return tokens
}

export function evaluateViewTableFormula(formula: string, resolveField: FormulaFieldResolver): string {
  return formatFormulaResult(new FormulaParser(tokenizeFormula(formula), resolveField).parse())
}
