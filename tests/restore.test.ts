import { describe, expect, it } from 'vitest'
import {
  buildSub2ApiPayload,
  createDownloadFileName,
  formatPayloadJson,
  restoreFromText,
  type JsonObject,
} from '../src/core/restore'

describe('restoreFromText', () => {
  it('converts multiple one-account lines into one account list', () => {
    const input = [
      JSON.stringify({ accounts: [account('acc-1', 'a@example.com')], proxies: [] }),
      JSON.stringify({ accounts: [account('acc-2', 'b@example.com')], proxies: [] }),
    ].join('\n')

    const result = restoreFromText(input)

    expect(result.errors).toEqual([])
    expect(result.validRows).toBe(2)
    expect(result.accountCount).toBe(2)
    expect(result.accounts.map((item) => item.name)).toEqual(['acc-1', 'acc-2'])
  })

  it('ignores blank lines and supports CRLF', () => {
    const input = [
      '',
      JSON.stringify({ accounts: [account('acc-1')], proxies: [] }),
      '',
      JSON.stringify({ accounts: [account('acc-2')], proxies: [] }),
      '',
    ].join('\r\n')

    const result = restoreFromText(input)

    expect(result.inputRows).toBe(2)
    expect(result.accountCount).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('reports invalid JSON lines without dropping the line silently', () => {
    const input = [
      JSON.stringify({ accounts: [account('acc-1')], proxies: [] }),
      '{"accounts":[',
    ].join('\n')

    const result = restoreFromText(input)

    expect(result.accountCount).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.line).toBe(2)
    expect(result.errors[0]?.message).toContain('不是合法 JSON')
  })

  it('rejects rows without accounts array', () => {
    const result = restoreFromText(JSON.stringify({ account: account('acc-1') }))

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain('缺少 accounts')
  })

  it('rejects invalid account shape', () => {
    const result = restoreFromText(
      JSON.stringify({
        accounts: [{ name: 'bad', platform: 'openai', type: 'oauth' }],
        proxies: [],
      }),
    )

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain('缺少 credentials')
  })

  it('keeps account objects and unknown fields intact', () => {
    const sourceAccount = account('acc-1')
    sourceAccount.extra = { custom: true }
    sourceAccount.credentials = {
      ...sourceAccount.credentials as JsonObject,
      organization_id: 'org-demo',
    }
    sourceAccount.unknown_field = { nested: ['x'] }

    const result = restoreFromText(JSON.stringify({ accounts: [sourceAccount], proxies: [] }))

    expect(result.errors).toHaveLength(0)
    expect(result.accounts[0]).toEqual(sourceAccount)
  })

  it('warns but supports a line containing multiple accounts', () => {
    const result = restoreFromText(
      JSON.stringify({
        accounts: [account('acc-1'), account('acc-2')],
        proxies: [],
      }),
    )

    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some((warning) => warning.message.includes('完整 JSON'))).toBe(true)
    expect(result.accountCount).toBe(2)
  })

  it('warns but supports multiple accounts inside one JSONL row', () => {
    const input = [
      JSON.stringify({
        accounts: [account('acc-1'), account('acc-2')],
        proxies: [],
        row_marker: 'forces-jsonl-branch',
      }),
      JSON.stringify({ accounts: [account('acc-3')], proxies: [] }),
    ].join('\n')

    const result = restoreFromText(input)

    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.line).toBe(1)
    expect(result.warnings[0]?.message).toContain('包含 2 个账号')
    expect(result.accountCount).toBe(3)
    expect(result.accounts.map((item) => item.name)).toEqual(['acc-1', 'acc-2', 'acc-3'])
  })

  it('merges proxies by proxy_key', () => {
    const proxy = {
      proxy_key: 'http|127.0.0.1|8080||',
      name: 'proxy',
      protocol: 'http',
      host: '127.0.0.1',
      port: 8080,
      status: 'active',
    }
    const input = [
      JSON.stringify({ accounts: [account('acc-1')], proxies: [proxy] }),
      JSON.stringify({ accounts: [account('acc-2')], proxies: [proxy] }),
    ].join('\n')

    const result = restoreFromText(input)

    expect(result.proxyCount).toBe(1)
    expect(result.proxies[0]).toEqual(proxy)
  })

  it('detects a complete sub2api JSON object', () => {
    const input = JSON.stringify(
      {
        exported_at: '2026-06-20T00:00:00.000Z',
        proxies: [],
        accounts: [account('acc-1'), account('acc-2')],
      },
      null,
      2,
    )

    const result = restoreFromText(input)

    expect(result.errors).toHaveLength(0)
    expect(result.accountCount).toBe(2)
    expect(result.warnings[0]?.message).toContain('完整 JSON')
  })
})

describe('buildSub2ApiPayload', () => {
  it('formats standard import JSON', () => {
    const result = restoreFromText(JSON.stringify({ accounts: [account('acc-1')], proxies: [] }))
    const payload = buildSub2ApiPayload(result, new Date('2026-06-20T00:00:00.000Z'))
    const json = formatPayloadJson(payload)

    expect(JSON.parse(json)).toEqual({
      exported_at: '2026-06-20T00:00:00.000Z',
      proxies: [],
      accounts: [account('acc-1')],
    })
    expect(json.endsWith('\n')).toBe(true)
  })

  it('creates stable local-style file names', () => {
    const fileName = createDownloadFileName(new Date('2026-06-20T03:04:05'))

    expect(fileName).toBe('sub2api-account-import_20260620_030405.json')
  })
})

function account(name: string, email = `${name}@example.com`): JsonObject {
  return {
    name,
    platform: 'openai',
    type: 'oauth',
    credentials: {
      access_token: `fake-access-token-${name}`,
      refresh_token: `fake-refresh-token-${name}`,
      id_token: `fake-id-token-${name}`,
      email,
    },
    extra: {},
    concurrency: 1,
    priority: 50,
    rate_multiplier: 1,
    auto_pause_on_expired: true,
  }
}
