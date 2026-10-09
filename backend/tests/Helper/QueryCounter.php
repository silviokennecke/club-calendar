<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use Doctrine\DBAL\Driver;
use Doctrine\DBAL\Driver\Connection;
use Doctrine\DBAL\Driver\Middleware;
use Doctrine\DBAL\Driver\Middleware\AbstractConnectionMiddleware;
use Doctrine\DBAL\Driver\Middleware\AbstractDriverMiddleware;
use Doctrine\DBAL\Driver\Middleware\AbstractStatementMiddleware;
use Doctrine\DBAL\Driver\Result;
use Doctrine\DBAL\Driver\Statement;

/**
 * Counts the SQL statements sent by the application (test environment only, see
 * config/services_test.yaml), so tests can prove that a list does not run one query per row.
 */
final class QueryCounter implements Middleware
{
    public static int $count = 0;

    public function wrap(Driver $driver): Driver
    {
        return new class($driver) extends AbstractDriverMiddleware {
            public function connect(array $params): Connection
            {
                return new class(parent::connect($params)) extends AbstractConnectionMiddleware {
                    public function prepare(string $sql): Statement
                    {
                        return new class(parent::prepare($sql)) extends AbstractStatementMiddleware {
                            public function execute(): Result
                            {
                                ++QueryCounter::$count;

                                return parent::execute();
                            }
                        };
                    }

                    public function query(string $sql): Result
                    {
                        ++QueryCounter::$count;

                        return parent::query($sql);
                    }

                    public function exec(string $sql): int|string
                    {
                        ++QueryCounter::$count;

                        return parent::exec($sql);
                    }
                };
            }
        };
    }
}
