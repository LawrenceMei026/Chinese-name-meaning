import { spawnSync } from 'node:child_process'

const python = process.platform === 'win32' ? 'python' : 'python3'
const result = spawnSync(python, ['-m', 'unittest', 'test_feature_contract.py'], {
  cwd: new URL('../', import.meta.url),
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
