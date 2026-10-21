// Load the very same V2 source in Node. Older Node releases without native
// .ts support use the project's existing TypeScript compiler in memory only.
import { readFile } from 'node:fs/promises'

let pending
export async function loadBrickRules() {
  if (!pending) pending = (async () => {
    try {
      const [assembly, catalog] = await Promise.all([
        import('../src/brick-test/assembly.ts'), import('../src/brick-test/catalog.ts'),
      ])
      return { ...catalog, ...assembly }
    } catch (error) {
      if (error.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw error
      return loadTranspiledBrickRules()
    }
  })()
  try { return await pending }
  catch (error) { pending = undefined; throw error }
}

export async function loadTranspiledBrickRules() {
  const ts = await import('typescript')
  const asModule = (source, filename) => {
    const result = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    })
    return `data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`
  }
  const catalogUrl = asModule(await readFile(new URL('../src/brick-test/catalog.ts', import.meta.url), 'utf8'), 'catalog.ts')
  const source = await readFile(new URL('../src/brick-test/assembly.ts', import.meta.url), 'utf8')
  const assemblyUrl = asModule(source.replaceAll("'./catalog.ts'", JSON.stringify(catalogUrl)), 'assembly.ts')
  const [catalog, assembly] = await Promise.all([import(catalogUrl), import(assemblyUrl)])
  return { ...catalog, ...assembly }
}
