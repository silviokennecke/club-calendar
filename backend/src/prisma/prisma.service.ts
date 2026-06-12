import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { env } from '../env'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ log: env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'] })
  }

  async onModuleInit() {
    await this.$connect()
  }
}
