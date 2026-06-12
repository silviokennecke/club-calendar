import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '../../..')

export async function setup() {
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
