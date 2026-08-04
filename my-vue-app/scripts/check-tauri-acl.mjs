import { readFile } from 'node:fs/promises'

const capabilityUrl = new URL('../src-tauri/capabilities/default.json', import.meta.url)
const capability = JSON.parse(await readFile(capabilityUrl, 'utf8'))
const requiredPermissions = ['core:event:allow-listen', 'core:event:allow-unlisten']
const requiredOpenerScopes = [
  'https://github.com/LawrenceMei026/Chinese-name-meaning*',
  'https://cc-cedict.org',
  'https://creativecommons.org/licenses/by-sa/4.0/',
]

if (!Array.isArray(capability.windows) || !capability.windows.includes('main')) {
  throw new Error('The default Tauri capability must apply to the main window.')
}

for (const permission of requiredPermissions) {
  if (!capability.permissions?.includes(permission)) {
    throw new Error(`Missing required Tauri permission: ${permission}`)
  }
}

const openerPermission = capability.permissions?.find(
  permission => permission?.identifier === 'opener:allow-open-url',
)
for (const requiredScope of requiredOpenerScopes) {
  if (!openerPermission?.allow?.some(scope => scope.url === requiredScope)) {
    throw new Error(`Missing required Tauri opener URL scope: ${requiredScope}`)
  }
}

console.log('Tauri event and external-link opener ACL is configured.')
