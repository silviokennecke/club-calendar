-- Make password nullable
ALTER TABLE `User` MODIFY COLUMN `password` VARCHAR(255) NULL;

-- Passkeys table
-- Note: credentialId stored as TEXT but indexed via hash (prefix) due to MySQL key length limit
CREATE TABLE `Passkey` (
  `id` VARCHAR(191) NOT NULL,
  `userId` INT NOT NULL,
  `credentialId` VARCHAR(700) NOT NULL,
  `publicKey` LONGBLOB NOT NULL,
  `counter` BIGINT NOT NULL DEFAULT 0,
  `deviceName` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Passkey_credentialId_key`(`credentialId`),
  INDEX `Passkey_userId_idx`(`userId`),
  CONSTRAINT `Passkey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- OAuth accounts table
CREATE TABLE `OAuthAccount` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `providerId` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OAuthAccount_provider_providerId_key`(`provider`, `providerId`),
  INDEX `OAuthAccount_userId_idx`(`userId`),
  CONSTRAINT `OAuthAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
