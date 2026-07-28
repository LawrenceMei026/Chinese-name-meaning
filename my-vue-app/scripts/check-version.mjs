import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const cargoToml = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const cargoPackage = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1]
const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const packageVersion = packageJson.version
const releaseTag = process.argv[2] || process.env.GITHUB_REF_NAME
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

if (typeof packageVersion !== 'string' || !semverPattern.test(packageVersion)) {
  throw new Error(`Invalid package version in ${projectRoot}package.json: ${String(packageVersion)}`)
}

if (tauriConfig.version !== '../package.json') {
  throw new Error(`Tauri must source its version from ../package.json, received: ${String(tauriConfig.version)}`)
}

if (cargoVersion !== packageVersion) {
  throw new Error(`Version mismatch: package.json=${packageVersion}, Cargo.toml=${cargoVersion ?? 'missing'}`)
}

if (releaseTag && releaseTag !== `v${packageVersion}`) {
  throw new Error(`Release tag ${releaseTag} must match package.json version v${packageVersion}`)
}

console.log(`Version ${packageVersion} is consistent${releaseTag ? ` with tag ${releaseTag}` : ''}.`)
