import { readFile, writeFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const cargoUrl = new URL('../src-tauri/Cargo.toml', import.meta.url)
const cargoToml = await readFile(cargoUrl, 'utf8')
const packageSection = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[0]

if (!packageSection || typeof packageJson.version !== 'string' || !/^version\s*=\s*"[^"]+"/m.test(packageSection)) {
  throw new Error('Unable to read package versions for synchronization.')
}

const updatedPackageSection = packageSection.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${packageJson.version}"`,
)

await writeFile(cargoUrl, cargoToml.replace(packageSection, updatedPackageSection))
console.log(`Synchronized Cargo.toml to version ${packageJson.version}.`)
