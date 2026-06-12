import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireClubMember } from '../middleware/requireClub.js'
import {
  listClubs, createClub, getClub, updateClub, deleteClub,
  listMembers, addMember, removeMember,
} from '../services/clubService.js'

export const clubRoutes = new Hono<{ Variables: { userId: number } }>()

const createClubSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1).default('Europe/Berlin'),
})

const updateClubSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().min(1).optional(),
})

clubRoutes.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const clubs = await listClubs(userId)
  return c.json(clubs)
})

clubRoutes.post('/', authMiddleware, zValidator('json', createClubSchema), async (c) => {
  const userId = c.get('userId')
  const data = c.req.valid('json')
  const club = await createClub(userId, data)
  return c.json(club, 201)
})

clubRoutes.get('/:clubId', authMiddleware, requireClubMember, async (c) => {
  const club = await getClub(Number(c.req.param('clubId')))
  return c.json(club)
})

clubRoutes.patch('/:clubId', authMiddleware, requireClubMember, zValidator('json', updateClubSchema), async (c) => {
  const club = await updateClub(Number(c.req.param('clubId')), c.req.valid('json'))
  return c.json(club)
})

clubRoutes.delete('/:clubId', authMiddleware, requireClubMember, async (c) => {
  await deleteClub(Number(c.req.param('clubId')))
  return c.json({ ok: true })
})

clubRoutes.get('/:clubId/members', authMiddleware, requireClubMember, async (c) => {
  const members = await listMembers(Number(c.req.param('clubId')))
  return c.json(members)
})

clubRoutes.post(
  '/:clubId/members',
  authMiddleware,
  requireClubMember,
  zValidator('json', z.object({ email: z.string().email() })),
  async (c) => {
    const { email } = c.req.valid('json')
    const user = await addMember(Number(c.req.param('clubId')), email)
    return c.json(user, 201)
  },
)

clubRoutes.delete('/:clubId/members/:userId', authMiddleware, requireClubMember, async (c) => {
  await removeMember(Number(c.req.param('clubId')), Number(c.req.param('userId')))
  return c.json({ ok: true })
})
