export type JsonObject = Record<string, unknown>

export interface RestoreIssue {
  line: number
  message: string
}

export interface AccountPreview {
  index: number
  name: string
  platform: string
  type: string
  email: string
}

export interface RestoreResult {
  totalLines: number
  inputRows: number
  validRows: number
  accountCount: number
  proxyCount: number
  duplicateNameCount: number
  duplicateEmailCount: number
  accounts: JsonObject[]
  proxies: JsonObject[]
  errors: RestoreIssue[]
  warnings: RestoreIssue[]
  previews: AccountPreview[]
}

export interface Sub2ApiImportPayload {
  exported_at: string
  proxies: JsonObject[]
  accounts: JsonObject[]
}

const MAX_PREVIEW_COUNT = 8

export function restoreFromText(input: string): RestoreResult {
  const normalizedInput = stripBom(input)
  const trimmed = normalizedInput.trim()

  if (trimmed === '') {
    return createEmptyResult(0)
  }

  const wholeJson = tryParseJson(trimmed)
  if (wholeJson.ok && isRecord(wholeJson.value) && Array.isArray(wholeJson.value.accounts)) {
    return parseWholePayload(wholeJson.value)
  }

  const lines = splitLines(normalizedInput)
  const accounts: JsonObject[] = []
  const proxiesByKey = new Map<string, JsonObject>()
  const errors: RestoreIssue[] = []
  const warnings: RestoreIssue[] = []
  let inputRows = 0
  let validRows = 0

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (line === '') {
      return
    }

    inputRows += 1
    const parsed = tryParseJson(line)
    if (!parsed.ok) {
      errors.push({
        line: lineNumber,
        message: `这一行不是合法 JSON：${parsed.errorMessage}`,
      })
      return
    }

    const row = parsed.value
    if (!isRecord(row)) {
      errors.push({
        line: lineNumber,
        message: '这一行不是对象格式，无法提取账号。',
      })
      return
    }

    const extracted = extractAccountsFromRow(row, lineNumber)
    if (extracted.errors.length > 0) {
      errors.push(...extracted.errors)
      return
    }

    validRows += 1
    accounts.push(...extracted.accounts)
    warnings.push(...extracted.warnings)
    mergeProxies(proxiesByKey, row.proxies)
  })

  return finalizeResult({
    totalLines: lines.length,
    inputRows,
    validRows,
    accounts,
    proxies: Array.from(proxiesByKey.values()),
    errors,
    warnings,
  })
}

export function buildSub2ApiPayload(
  result: Pick<RestoreResult, 'accounts' | 'proxies'>,
  exportedAt = new Date(),
): Sub2ApiImportPayload {
  return {
    exported_at: exportedAt.toISOString(),
    proxies: result.proxies,
    accounts: result.accounts,
  }
}

export function formatPayloadJson(payload: Sub2ApiImportPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function createDownloadFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')

  return `sub2api-account-import_${stamp}.json`
}

function parseWholePayload(payload: JsonObject): RestoreResult {
  const accountsValue = payload.accounts
  const proxiesValue = payload.proxies
  const accounts: JsonObject[] = []
  const proxiesByKey = new Map<string, JsonObject>()
  const errors: RestoreIssue[] = []
  const warnings: RestoreIssue[] = [
    {
      line: 1,
      message: '检测到完整 JSON 对象，已按其中的 accounts 数组生成导入文件。',
    },
  ]

  if (!Array.isArray(accountsValue) || accountsValue.length === 0) {
    errors.push({
      line: 1,
      message: '完整 JSON 中的 accounts 为空，无法生成导入文件。',
    })
  } else {
    accountsValue.forEach((item, index) => {
      const accountLine = index + 1
      if (!isRecord(item)) {
        errors.push({
          line: accountLine,
          message: `accounts 第 ${index + 1} 项不是对象。`,
        })
        return
      }

      const error = validateAccount(item)
      if (error) {
        errors.push({
          line: accountLine,
          message: `accounts 第 ${index + 1} 项无效：${error}`,
        })
        return
      }

      accounts.push(item)
    })
  }

  mergeProxies(proxiesByKey, proxiesValue)

  return finalizeResult({
    totalLines: 1,
    inputRows: 1,
    validRows: errors.length === 0 ? 1 : 0,
    accounts,
    proxies: Array.from(proxiesByKey.values()),
    errors,
    warnings,
  })
}

function extractAccountsFromRow(row: JsonObject, line: number): {
  accounts: JsonObject[]
  errors: RestoreIssue[]
  warnings: RestoreIssue[]
} {
  const accountsValue = row.accounts
  const accounts: JsonObject[] = []
  const errors: RestoreIssue[] = []
  const warnings: RestoreIssue[] = []

  if (!Array.isArray(accountsValue)) {
    errors.push({
      line,
      message: '缺少 accounts 数组。正确的一行通常长这样：{"accounts":[{...}],"proxies":[]}',
    })
    return { accounts, errors, warnings }
  }

  if (accountsValue.length === 0) {
    errors.push({
      line,
      message: 'accounts 数组为空，这一行没有账号。',
    })
    return { accounts, errors, warnings }
  }

  if (accountsValue.length > 1) {
    warnings.push({
      line,
      message: `这一行包含 ${accountsValue.length} 个账号，已全部合并到最终 JSON。`,
    })
  }

  accountsValue.forEach((account, index) => {
    if (!isRecord(account)) {
      errors.push({
        line,
        message: `accounts 第 ${index + 1} 项不是对象。`,
      })
      return
    }

    const error = validateAccount(account)
    if (error) {
      errors.push({
        line,
        message: `accounts 第 ${index + 1} 项无效：${error}`,
      })
      return
    }

    accounts.push(account)
  })

  return { accounts, errors, warnings }
}

function validateAccount(account: JsonObject): string | null {
  if (!isNonEmptyString(account.name)) {
    return '缺少 name。'
  }

  if (!isNonEmptyString(account.platform)) {
    return '缺少 platform。'
  }

  if (!isNonEmptyString(account.type)) {
    return '缺少 type。'
  }

  if (!isRecord(account.credentials) || Object.keys(account.credentials).length === 0) {
    return '缺少 credentials。'
  }

  if (account.extra !== undefined && account.extra !== null && !isRecord(account.extra)) {
    return 'extra 必须是对象。'
  }

  return null
}

function finalizeResult(input: {
  totalLines: number
  inputRows: number
  validRows: number
  accounts: JsonObject[]
  proxies: JsonObject[]
  errors: RestoreIssue[]
  warnings: RestoreIssue[]
}): RestoreResult {
  const duplicateNameCount = countDuplicates(input.accounts, (account) =>
    asText(account.name).trim().toLowerCase(),
  )
  const duplicateEmailCount = countDuplicates(input.accounts, (account) => {
    const credentials = isRecord(account.credentials) ? account.credentials : {}
    return asText(credentials.email).trim().toLowerCase()
  })

  return {
    totalLines: input.totalLines,
    inputRows: input.inputRows,
    validRows: input.validRows,
    accountCount: input.accounts.length,
    proxyCount: input.proxies.length,
    duplicateNameCount,
    duplicateEmailCount,
    accounts: input.accounts,
    proxies: input.proxies,
    errors: input.errors,
    warnings: input.warnings,
    previews: input.accounts.slice(0, MAX_PREVIEW_COUNT).map(createPreview),
  }
}

function createPreview(account: JsonObject, index: number): AccountPreview {
  const credentials = isRecord(account.credentials) ? account.credentials : {}

  return {
    index: index + 1,
    name: safeDisplay(asText(account.name), '未命名账号'),
    platform: safeDisplay(asText(account.platform), '-'),
    type: safeDisplay(asText(account.type), '-'),
    email: maskEmail(asText(credentials.email)),
  }
}

function mergeProxies(target: Map<string, JsonObject>, value: unknown): void {
  if (!Array.isArray(value)) {
    return
  }

  value.forEach((proxy, index) => {
    if (!isRecord(proxy)) {
      return
    }

    const key = isNonEmptyString(proxy.proxy_key)
      ? proxy.proxy_key
      : `proxy-${index}-${JSON.stringify(proxy)}`

    if (!target.has(key)) {
      target.set(key, proxy)
    }
  })
}

function countDuplicates(accounts: JsonObject[], pick: (account: JsonObject) => string): number {
  const seen = new Map<string, number>()

  accounts.forEach((account) => {
    const key = pick(account)
    if (key === '') {
      return
    }
    seen.set(key, (seen.get(key) ?? 0) + 1)
  })

  let count = 0
  seen.forEach((value) => {
    if (value > 1) {
      count += value
    }
  })

  return count
}

function tryParseJson(value: string):
  | { ok: true; value: unknown }
  | { ok: false; errorMessage: string } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : '未知解析错误',
    }
  }
}

function splitLines(input: string): string[] {
  return input.split(/\r\n|\n|\r/)
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function safeDisplay(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
}

function maskEmail(email: string): string {
  const trimmed = email.trim()
  const atIndex = trimmed.indexOf('@')
  if (trimmed === '' || atIndex <= 0) {
    return '未提供'
  }

  const name = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex + 1)
  const visibleName = name.length <= 2 ? `${name[0] ?? '*'}*` : `${name.slice(0, 2)}***`
  return `${visibleName}@${domain}`
}

function createEmptyResult(totalLines: number): RestoreResult {
  return {
    totalLines,
    inputRows: 0,
    validRows: 0,
    accountCount: 0,
    proxyCount: 0,
    duplicateNameCount: 0,
    duplicateEmailCount: 0,
    accounts: [],
    proxies: [],
    errors: [],
    warnings: [],
    previews: [],
  }
}
