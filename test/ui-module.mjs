// Compile the actual small TSX controls for server-rendering tests. No production loader.
import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
export async function uiModuleUrl(url) {
  let code = ts.transpileModule(await readFile(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  code = code.replace(/import ['"].*\.css['"];?/g, '')
  for (const name of ['react', 'react/jsx-runtime']) {
    code = code.replaceAll(`'${name}'`, JSON.stringify(pathToFileURL(require.resolve(name)).href)).replaceAll(`"${name}"`, JSON.stringify(pathToFileURL(require.resolve(name)).href))
  }
  if (code.includes("'./InfoHint'")) code = code.replaceAll("'./InfoHint'", JSON.stringify(await uiModuleUrl(new URL('./InfoHint.tsx', url))))
  code = code.replaceAll("'./image-history.mjs'", JSON.stringify(new URL('./image-history.mjs', url).href))
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
