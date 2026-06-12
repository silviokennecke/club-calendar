ALTER TABLE `User`
  ADD COLUMN `dateFormat` VARCHAR(20) NOT NULL DEFAULT 'dd.MM.yyyy' AFTER `password`,
  ADD COLUMN `firstDayOfWeek` TINYINT NOT NULL DEFAULT 1 AFTER `dateFormat`;

ALTER TABLE `Calendar`
  ADD COLUMN `timezone` VARCHAR(100) NULL AFTER `name`;
