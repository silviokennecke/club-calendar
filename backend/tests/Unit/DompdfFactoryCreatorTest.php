<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\DompdfFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class DompdfFactoryCreatorTest extends TestCase
{
    #[DataProvider('urls')]
    public function testCreator(string $appUrl, string $expected): void
    {
        $factory = new DompdfFactory('/tmp', '/tmp', $appUrl);

        self::assertSame($expected, $factory->creator());
    }

    /** @return iterable<string, array{string, string}> */
    public static function urls(): iterable
    {
        yield 'clean' => ['https://kalender.example.org', 'Club Calendar (https://kalender.example.org)'];
        yield 'trailing slash' => ['https://kalender.example.org/', 'Club Calendar (https://kalender.example.org)'];
        yield 'port and path with tilde' => ['http://localhost:8080/~app', 'Club Calendar (http://localhost:8080/~app)'];
        yield 'empty' => ['', 'Club Calendar'];
        yield 'userinfo' => ['https://user:pw@example.org', 'Club Calendar'];
        yield 'query' => ['https://example.org/?x=1', 'Club Calendar'];
    }
}
