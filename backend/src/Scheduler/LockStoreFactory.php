<?php

declare(strict_types=1);

namespace App\Scheduler;

use Doctrine\DBAL\Connection;
use Symfony\Component\Lock\PersistingStoreInterface;
use Symfony\Component\Lock\Store\DoctrineDbalStore;
use Symfony\Component\Lock\Store\StoreFactory;

final class LockStoreFactory
{
    /** An empty LOCK_DSN means: the application database (shared by all containers). */
    public static function create(Connection $connection, string $dsn): PersistingStoreInterface
    {
        if ('' === trim($dsn)) {
            return new DoctrineDbalStore($connection, ['db_table' => 'lock_keys'], 0.01, 300);
        }

        return StoreFactory::createStore($dsn);
    }
}
