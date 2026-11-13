<?php

declare(strict_types=1);

namespace App\Storage;

use Aws\CommandInterface;
use Psr\Http\Message\RequestInterface;

/**
 * AWS SDK handler-list middleware that adds the SSE-C parameters to every S3 operation that reads or writes
 * object data (also the copy source of copies, so Flysystem's copy/move and multipart paths keep working).
 * Parameters already set on the command win, which lets callers address an object under another key.
 * The SDK's own SSECMiddleware (runs after this one) base64-encodes the raw key, adds the MD5 and refuses http.
 */
final class SseCMiddleware
{
    private const OPERATIONS = ['GetObject', 'HeadObject', 'PutObject', 'CopyObject', 'CreateMultipartUpload', 'UploadPart', 'UploadPartCopy', 'GetObjectAttributes'];
    private const COPIES = ['CopyObject', 'UploadPartCopy'];

    public static function create(SseCKey $key): callable
    {
        return static function (callable $handler) use ($key): callable {
            return static function (CommandInterface $command, ?RequestInterface $request = null) use ($handler, $key) {
                $name = $command->getName();
                if (in_array($name, self::OPERATIONS, true)) {
                    self::fill($command, '', $key);
                    if (in_array($name, self::COPIES, true)) {
                        self::fill($command, 'CopySource', $key);
                    }
                }

                return $handler($command, $request);
            };
        };
    }

    private static function fill(CommandInterface $command, string $prefix, SseCKey $key): void
    {
        if (isset($command[$prefix.'SSECustomerKey'])) {
            return;
        }
        $command[$prefix.'SSECustomerAlgorithm'] = SseCKey::ALGORITHM;
        $command[$prefix.'SSECustomerKey'] = $key->raw();
    }
}
