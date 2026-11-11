<?php

// Fetches the current uap-core regexes and rewrites the library's regexes.php.
// The new data is verified in a temp directory first; on any failure the shipped file stays.
declare(strict_types=1);

use Symfony\Component\Filesystem\Filesystem;
use UAParser\Parser;
use UAParser\Util\Converter;
use UAParser\Util\Fetcher;

require dirname(__DIR__).'/vendor/autoload.php';

$target = dirname(__DIR__).'/vendor/ua-parser/uap-php/resources';
$tmp = sys_get_temp_dir().'/uap-'.bin2hex(random_bytes(4));
(new Filesystem())->mkdir($tmp);

try {
    (new Converter($tmp))->convertString((new Fetcher())->fetch(), false);
    $check = Parser::create($tmp.'/regexes.php')->parse(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    )->ua;
    if ('Chrome' !== $check->family || '126' !== $check->major) {
        throw new RuntimeException('fetched data failed the sanity check');
    }
    (new Filesystem())->copy($tmp.'/regexes.php', $target.'/regexes.php', true);
    echo "uap-core regexes updated\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'WARNING: uap-core update failed, keeping the shipped data: '.$e->getMessage()."\n");
    exit(1);
} finally {
    (new Filesystem())->remove($tmp);
}
