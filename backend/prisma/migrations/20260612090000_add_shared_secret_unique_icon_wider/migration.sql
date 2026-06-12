-- AlterTable: make sharedSecret unique and widen icon column
ALTER TABLE `CalendarFeed` ADD UNIQUE INDEX `CalendarFeed_sharedSecret_key`(`sharedSecret`);
ALTER TABLE `Property` MODIFY COLUMN `icon` VARCHAR(32) NULL;
