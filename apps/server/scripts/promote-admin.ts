// Usage: npx tsx scripts/promote-admin.ts <username> [role]
// Role defaults to SUPERADMIN if not specified.
// Valid roles: MODERATOR, ADMIN, SUPERADMIN, ROOT

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const username = process.argv[2]
const role = (process.argv[3] ?? 'SUPERADMIN').toUpperCase()

const VALID_ROLES = ['MODERATOR', 'ADMIN', 'SUPERADMIN', 'ROOT']

if (!username) {
  console.error('Usage: npx tsx scripts/promote-admin.ts <username> [role]')
  process.exit(1)
}

if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`)
  process.exit(1)
}

const user = await prisma.user.findUnique({ where: { username } })
if (!user) {
  console.error(`User "${username}" not found`)
  await prisma.$disconnect()
  process.exit(1)
}

await prisma.user.update({ where: { username }, data: { role: role as any } })
console.log(`Promoted ${username} to ${role}`)
await prisma.$disconnect()
