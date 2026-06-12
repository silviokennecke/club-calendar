import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '../..')

function loadDotEnv() {
  try {
    const envPath = path.join(backendRoot, '.env')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // ignore if .env not found
  }
}

export async function setup() {
  loadDotEnv()
  const testDbUrl = process.env.TEST_DATABASE_URL
  if (!testDbUrl) throw new Error('TEST_DATABASE_URL is not set')
  execSync('npx prisma migrate deploy', {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'pipe',
  })
}

export async function teardown() {
  // nothing — tables are truncated per-test in setup.ts
}
