import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { verifyPassword, hashPassword } from '../lib/password'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt'
import { unauthorized, badRequest } from '../lib/errors'

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(name: string, email: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) throw badRequest('Email already in use')
    const hashed = await hashPassword(password)
    const user = await this.prisma.user.create({ data: { name, email, password: hashed } })
    const accessToken = await signAccessToken(user.id)
    const refreshToken = await signRefreshToken(user.id)
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        dateFormat: user.dateFormat,
        firstDayOfWeek: user.firstDayOfWeek,
        lastClubId: user.lastClubId,
        lastCalendarId: user.lastCalendarId,
      },
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) throw unauthorized('Invalid credentials')
    const valid = await verifyPassword(password, user.password)
    if (!valid) throw unauthorized('Invalid credentials')
    const accessToken = await signAccessToken(user.id)
    const refreshToken = await signRefreshToken(user.id)
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        dateFormat: user.dateFormat,
        firstDayOfWeek: user.firstDayOfWeek,
        lastClubId: user.lastClubId,
        lastCalendarId: user.lastCalendarId,
      },
    }
  }

  async refresh(refreshToken: string) {
    const payload = await verifyRefreshToken(refreshToken).catch(() => {
      throw unauthorized('Invalid refresh token')
    })
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) throw unauthorized('User not found')
    const accessToken = await signAccessToken(user.id)
    return { accessToken }
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        dateFormat: true,
        firstDayOfWeek: true,
        lastClubId: true,
        lastCalendarId: true,
        passkeys: { select: { id: true, deviceName: true, createdAt: true } },
        oauthAccounts: { select: { provider: true } },
      },
    })
    if (!user) throw unauthorized('User not found')
    return user
  }

  async updateMe(
    userId: number,
    data: {
      dateFormat?: string
      firstDayOfWeek?: number
      lastClubId?: number | null
      lastCalendarId?: number | null
    },
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        dateFormat: true,
        firstDayOfWeek: true,
        lastClubId: true,
        lastCalendarId: true,
      },
    })
    return user
  }

  async deleteMe(userId: number) {
    await this.prisma.user.delete({ where: { id: userId } })
  }

  async findOrCreateOAuthUser(
    provider: string,
    providerId: string,
    email: string,
    name: string,
  ) {
    // Check existing OAuth account (use findFirst to handle orphaned records gracefully)
    const existing = await this.prisma.oAuthAccount.findFirst({
      where: { provider, providerId },
      include: { user: true },
    })
    if (existing) {
      if (!existing.user) {
        // Orphaned account — user was deleted externally; clean up and fall through
        await this.prisma.oAuthAccount.delete({ where: { id: existing.id } })
      } else {
        const accessToken = await signAccessToken(existing.user.id)
        const refreshToken = await signRefreshToken(existing.user.id)
        return {
          accessToken,
          refreshToken,
          user: {
            id: existing.user.id,
            name: existing.user.name,
            email: existing.user.email,
            dateFormat: existing.user.dateFormat,
            firstDayOfWeek: existing.user.firstDayOfWeek,
            lastClubId: existing.user.lastClubId,
            lastCalendarId: existing.user.lastCalendarId,
          },
        }
      }
    }
    // Check existing user by email — link them
    let user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) {
      user = await this.prisma.user.create({ data: { name, email, password: null } })
    }
    await this.prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerId, email } })
    const accessToken = await signAccessToken(user.id)
    const refreshToken = await signRefreshToken(user.id)
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        dateFormat: user.dateFormat,
        firstDayOfWeek: user.firstDayOfWeek,
        lastClubId: user.lastClubId,
        lastCalendarId: user.lastCalendarId,
      },
    }
  }
}
