import './style.css'
import {
  buildSub2ApiPayload,
  createDownloadFileName,
  formatPayloadJson,
  restoreFromText,
  type RestoreIssue,
  type RestoreResult,
} from './core/restore'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found.')
}

app.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <div class="brand-row" aria-label="工具名称">
        <div class="brand-mark" aria-hidden="true">转</div>
        <div>
          <p class="eyebrow">本地部署 · 离线运行 · 开源可审计</p>
          <h1>sub2api TXT 转 JSON 离线工具</h1>
        </div>
      </div>
      <p class="lead">
        专门用来把“一行一号”的 TXT 卡密内容转换成 sub2api 可导入 JSON。适合链动小铺等平台发放的一行一个账号卡密。
      </p>
      <div class="notice" role="note">
        <strong>本工具不会上传数据。</strong>
        文件读取、解析和下载都在当前浏览器本地完成，不联网、不保存、不展示完整 token。
      </div>
    </header>

    <section class="workspace" aria-label="转换工作区">
      <section class="panel input-panel" aria-labelledby="input-title">
        <div class="panel-head">
          <div>
            <h2 id="input-title">粘贴或导入卡密 TXT</h2>
            <p>每一行应是一个账号包，例如 {"accounts":[{...}],"proxies":[]}。</p>
          </div>
          <label class="file-button" for="file-input">选择 TXT</label>
          <input id="file-input" type="file" accept=".txt,text/plain,.json,application/json" />
        </div>

        <div id="drop-zone" class="drop-zone">
          <textarea
            id="source-text"
            spellcheck="false"
            autocomplete="off"
            placeholder='把链动小铺发放的一行一号卡密粘贴到这里。示例：&#10;{"accounts":[{"name":"账号1","platform":"openai","type":"oauth","credentials":{"access_token":"示例"}}],"proxies":[]}'
            aria-label="一行一号 TXT 内容"
          ></textarea>
        </div>

        <div class="toolbar" aria-label="操作按钮">
          <button id="clear-button" class="button secondary" type="button">清空</button>
          <button id="check-button" class="button secondary strong" type="button">检查内容</button>
          <button id="download-button" class="button primary" type="button" disabled>下载 sub2api JSON</button>
        </div>
      </section>

      <aside class="panel result-panel" aria-labelledby="result-title">
        <div class="panel-head result-head">
          <div>
            <h2 id="result-title">检查结果</h2>
            <p id="status-text">等待输入 TXT 内容。</p>
          </div>
        </div>

        <div class="stats-grid" aria-label="统计">
          <div class="stat"><span id="stat-rows">0</span><label>有效行</label></div>
          <div class="stat"><span id="stat-accounts">0</span><label>账号数</label></div>
          <div class="stat"><span id="stat-errors">0</span><label>错误</label></div>
          <div class="stat"><span id="stat-proxies">0</span><label>代理</label></div>
        </div>

        <div class="result-block">
          <div class="block-title">账号预览</div>
          <div id="preview-list" class="preview-list empty">检查通过后显示前几个账号的安全摘要。</div>
        </div>

        <div class="result-block">
          <div class="block-title">提示</div>
          <div id="issue-list" class="issue-list empty">暂无提示。</div>
        </div>
      </aside>
    </section>

    <section class="guide" aria-label="使用流程">
      <div>
        <h2>输出格式</h2>
        <p>生成的文件是单个 JSON，结构与 sub2api 导出的账号文件一致：exported_at、proxies、accounts。粘贴 80 行，就会得到一个包含 80 个账号的 JSON 文件。</p>
      </div>
      <div>
        <h2>导入位置</h2>
        <p>下载 JSON 后，进入 sub2api 后台账号管理页面，使用“数据导入”功能选择这个 JSON 文件。导入前建议先备份原账号数据。</p>
      </div>
      <div>
        <h2>隐私边界</h2>
        <p>页面没有服务器地址，也没有网络请求。谨慎使用时可以先断网，再打开这个 HTML 文件进行转换。</p>
      </div>
    </section>
  </main>
`

const sourceText = query<HTMLTextAreaElement>('#source-text')
const fileInput = query<HTMLInputElement>('#file-input')
const dropZone = query<HTMLDivElement>('#drop-zone')
const clearButton = query<HTMLButtonElement>('#clear-button')
const checkButton = query<HTMLButtonElement>('#check-button')
const downloadButton = query<HTMLButtonElement>('#download-button')
const statusText = query<HTMLParagraphElement>('#status-text')
const statRows = query<HTMLSpanElement>('#stat-rows')
const statAccounts = query<HTMLSpanElement>('#stat-accounts')
const statErrors = query<HTMLSpanElement>('#stat-errors')
const statProxies = query<HTMLSpanElement>('#stat-proxies')
const previewList = query<HTMLDivElement>('#preview-list')
const issueList = query<HTMLDivElement>('#issue-list')

let currentResult: RestoreResult | null = null

checkButton.addEventListener('click', () => {
  runCheck()
})

clearButton.addEventListener('click', () => {
  sourceText.value = ''
  currentResult = null
  renderResult(null)
  sourceText.focus()
})

downloadButton.addEventListener('click', () => {
  if (!currentResult || currentResult.errors.length > 0 || currentResult.accountCount === 0) {
    return
  }

  const payload = buildSub2ApiPayload(currentResult)
  const content = formatPayloadJson(payload)
  downloadTextFile(createDownloadFileName(), content)
})

sourceText.addEventListener('input', () => {
  currentResult = null
  downloadButton.disabled = true
  statusText.textContent = '内容已变化，请重新检查。'
})

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) {
    return
  }

  await loadFileIntoEditor(file, `已读取文件：${file.name}。请点击“检查内容”。`)
})

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropZone.classList.add('dragging')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragging')
})

dropZone.addEventListener('drop', async (event) => {
  event.preventDefault()
  dropZone.classList.remove('dragging')

  const file = event.dataTransfer?.files?.[0]
  if (!file) {
    return
  }

  await loadFileIntoEditor(file, `已拖入文件：${file.name}。请点击“检查内容”。`)
})

async function loadFileIntoEditor(file: File, successMessage: string): Promise<void> {
  try {
    sourceText.value = await file.text()
    currentResult = null
    renderResult(null)
    statusText.textContent = successMessage
  } catch (error) {
    currentResult = null
    renderResult(null)
    statusText.textContent = error instanceof Error
      ? `文件读取失败：${error.message}`
      : '文件读取失败，请重新选择文件或直接复制粘贴。'
  } finally {
    fileInput.value = ''
  }
}

function runCheck(): void {
  currentResult = restoreFromText(sourceText.value)
  renderResult(currentResult)
}

function renderResult(result: RestoreResult | null): void {
  if (!result) {
    statusText.textContent = '等待输入 TXT 内容。'
    statRows.textContent = '0'
    statAccounts.textContent = '0'
    statErrors.textContent = '0'
    statProxies.textContent = '0'
    previewList.className = 'preview-list empty'
    previewList.textContent = '检查通过后显示前几个账号的安全摘要。'
    issueList.className = 'issue-list empty'
    issueList.textContent = '暂无提示。'
    downloadButton.disabled = true
    return
  }

  statRows.textContent = String(result.validRows)
  statAccounts.textContent = String(result.accountCount)
  statErrors.textContent = String(result.errors.length)
  statProxies.textContent = String(result.proxyCount)

  if (result.accountCount === 0 && result.errors.length === 0) {
    statusText.textContent = '没有检测到账号，请粘贴一行一号 TXT 内容。'
  } else if (result.errors.length > 0) {
    statusText.textContent = `发现 ${result.errors.length} 个错误。请先修正错误行，再下载 JSON。`
  } else {
    statusText.textContent = `检查通过：将生成 1 个 JSON 文件，包含 ${result.accountCount} 个账号。`
  }

  renderPreviews(result)
  renderIssues(result)
  downloadButton.disabled = result.errors.length > 0 || result.accountCount === 0
}

function renderPreviews(result: RestoreResult): void {
  if (result.previews.length === 0) {
    previewList.className = 'preview-list empty'
    previewList.textContent = '暂无可预览账号。'
    return
  }

  previewList.className = 'preview-list'
  previewList.replaceChildren(
    ...result.previews.map((preview) => {
      const item = document.createElement('div')
      item.className = 'preview-item'
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(preview.name)}</strong>
          <span>${escapeHtml(preview.platform)} / ${escapeHtml(preview.type)}</span>
        </div>
        <code>${escapeHtml(preview.email)}</code>
      `
      return item
    }),
  )
}

function renderIssues(result: RestoreResult): void {
  const issues: Array<{ type: 'error' | 'warning'; issue: RestoreIssue }> = [
    ...result.errors.map((issue) => ({ type: 'error' as const, issue })),
    ...result.warnings.map((issue) => ({ type: 'warning' as const, issue })),
  ]

  if (result.duplicateNameCount > 0) {
    issues.push({
      type: 'warning',
      issue: {
        line: 0,
        message: `检测到 ${result.duplicateNameCount} 个重复账号名。不会自动删除，请确认这是否符合预期。`,
      },
    })
  }

  if (result.duplicateEmailCount > 0) {
    issues.push({
      type: 'warning',
      issue: {
        line: 0,
        message: `检测到 ${result.duplicateEmailCount} 个重复邮箱。不会自动删除，请确认这是否符合预期。`,
      },
    })
  }

  if (issues.length === 0) {
    issueList.className = 'issue-list empty'
    issueList.textContent = '没有发现错误。'
    return
  }

  issueList.className = 'issue-list'
  issueList.replaceChildren(
    ...issues.map(({ type, issue }) => {
      const item = document.createElement('div')
      item.className = `issue ${type}`
      const lineText = issue.line > 0 ? `第 ${issue.line} 行` : '整体提示'
      item.innerHTML = `<strong>${lineText}</strong><span>${escapeHtml(issue.message)}</span>`
      return item
    }),
  )
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }
  return element
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
