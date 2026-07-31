import { readFile } from 'node:fs/promises'

const capabilityUrl = new URL('../src-tauri/capabilities/default.json', import.meta.url)
const capability = JSON.parse(await readFile(capabilityUrl, 'utf8'))
const requiredPermissions = [
  'core:event:allow-listen',
  'core:event:allow-unlisten',
]

if (!Array.isArray(capability.windows) || !capability.windows.includes('main')) {
  throw new Error('The default Tauri capability must apply to the main window.')
}

for (const permission of requiredPermissions) {
  if (!capability.permissions?.includes(permission)) {
    throw new Error(`Missing required Tauri permission: ${permission}`)
  }
}

console.log('Tauri event ACL is configured for model download progress.')
