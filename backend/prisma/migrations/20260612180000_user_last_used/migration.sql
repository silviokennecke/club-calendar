ALTER TABLE `User`
  ADD COLUMN `lastClubId` INT NULL AFTER `firstDayOfWeek`,
  ADD COLUMN `lastCalendarId` INT NULL AFTER `lastClubId`;
