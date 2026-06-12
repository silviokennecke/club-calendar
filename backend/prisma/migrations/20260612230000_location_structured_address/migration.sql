ALTER TABLE `Location` ADD COLUMN `street` VARCHAR(255) NULL;
ALTER TABLE `Location` ADD COLUMN `zip` VARCHAR(20) NULL;
ALTER TABLE `Location` ADD COLUMN `city` VARCHAR(255) NULL;
ALTER TABLE `Location` ADD COLUMN `country` VARCHAR(100) NULL;
UPDATE `Location` SET `street` = `address`;
ALTER TABLE `Location` DROP COLUMN `address`;
