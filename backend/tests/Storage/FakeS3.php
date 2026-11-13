<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\S3ClientFactory;
use Aws\CommandInterface;
use Aws\Exception\AwsException;
use Aws\Result;
use Aws\S3\S3Client;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Message\RequestInterface;

/**
 * Tiny in-memory S3 (path style, bucket "bkt") used as the command-level handler of a real S3Client, so the real
 * serializer, SSE-C middleware and signer run. Objects remember the MD5 header of the key they were written with
 * (null = unencrypted) and every read, head and copy source must present the same one, like S3 does.
 */
final class FakeS3
{
    /** @var array<string, array{body: string, md5: ?string, etag: string}> */
    public array $objects = [];
    /** @var list<array{op: string, key: string, headers: array<string, string>, query: array<string, mixed>}> */
    public array $log = [];
    /** @var array<string, int> object key => reported size override */
    public array $sizes = [];
    private int $etags = 0;

    public function client(bool $withSseC = false, ?string $sseCKeyBase64 = null): S3Client
    {
        $factory = new S3ClientFactory('https://s3.test', 'eu-central-1', 'AK', 'SK', true, $sseCKeyBase64 ?? '');

        return $factory->build($withSseC, ['handler' => $this]);
    }

    public function put(string $key, string $body, ?string $md5): void
    {
        $this->objects[$key] = ['body' => $body, 'md5' => $md5, 'etag' => '"e'.(++$this->etags).'"'];
    }

    public function md5Of(string $key): ?string
    {
        return $this->objects[$key]['md5'];
    }

    /** @return \GuzzleHttp\Promise\PromiseInterface */
    public function __invoke(CommandInterface $command, RequestInterface $request)
    {
        $path = ltrim(rawurldecode($request->getUri()->getPath()), '/');
        $key = str_starts_with($path, 'bkt/') ? substr($path, 4) : '';
        parse_str($request->getUri()->getQuery(), $query);
        $headers = [];
        foreach ($request->getHeaders() as $name => $values) {
            $headers[strtolower($name)] = $values[0];
        }
        $this->log[] = ['op' => $command->getName(), 'key' => $key, 'headers' => $headers, 'query' => $query];

        $md5 = $headers['x-amz-server-side-encryption-customer-key-md5'] ?? null;
        $this->assertConsistent($headers, 'x-amz-server-side-encryption-customer-');

        try {
            $result = match ($command->getName()) {
                'ListObjectsV2' => $this->list((string) ($query['prefix'] ?? '')),
                'PutObject' => $this->doPut($key, (string) $request->getBody(), $md5),
                'GetObject' => $this->doGet($key, $md5),
                'HeadObject' => $this->doHead($key, $md5),
                'GetObjectAcl' => new Result(['Owner' => ['ID' => 'o'], 'Grants' => []]),
                'DeleteObject' => $this->doDelete($key),
                'CopyObject' => $this->doCopy($key, $headers, $md5),
                default => throw $this->error($command, 501, 'NotImplemented'),
            };
        } catch (\Throwable $e) {
            if ($e instanceof AwsException) {
                return Create::rejectionFor($e);
            }
            throw $e;
        }

        return Create::promiseFor($result);
    }

    /** @param array<string, string> $headers */
    private function assertConsistent(array $headers, string $prefix): void
    {
        $key = $headers[$prefix.'key'] ?? null;
        if (null === $key) {
            return;
        }
        if (($headers[$prefix.'algorithm'] ?? null) !== 'AES256' || base64_encode(md5((string) base64_decode($key, true), true)) !== ($headers[$prefix.'key-md5'] ?? null)) {
            throw new \LogicException('Inconsistent SSE-C headers');
        }
    }

    private function error(CommandInterface $command, int $status, string $code): AwsException
    {
        return new AwsException($code, $command, ['code' => $code, 'response' => new Response($status)]);
    }

    private function fail(int $status, string $code): never
    {
        throw new AwsException($code, new \Aws\Command('x'), ['code' => $code, 'response' => new Response($status)]);
    }

    private function open(string $key, ?string $md5): array
    {
        if (!isset($this->objects[$key])) {
            $this->fail(404, 'NoSuchKey');
        }
        if ($this->objects[$key]['md5'] !== $md5) {
            $this->fail(400, 'BadRequest');
        }

        return $this->objects[$key];
    }

    private function list(string $prefix): Result
    {
        $contents = [];
        foreach ($this->objects as $key => $object) {
            if (str_starts_with($key, $prefix)) {
                $contents[] = ['Key' => $key, 'Size' => $this->sizes[$key] ?? strlen($object['body'])];
            }
        }

        return new Result(['Contents' => $contents, 'IsTruncated' => false]);
    }

    private function doPut(string $key, string $body, ?string $md5): Result
    {
        $this->put($key, $body, $md5);

        return new Result(['ETag' => $this->objects[$key]['etag']]);
    }

    private function doGet(string $key, ?string $md5): Result
    {
        $o = $this->open($key, $md5);

        return new Result(['Body' => Utils::streamFor($o['body']), 'ContentLength' => strlen($o['body']), 'ETag' => $o['etag']]);
    }

    private function doHead(string $key, ?string $md5): Result
    {
        $o = $this->open($key, $md5);

        return new Result(['ContentLength' => strlen($o['body']), 'ETag' => $o['etag'], 'LastModified' => new \DateTimeImmutable('2026-01-01')]);
    }

    private function doDelete(string $key): Result
    {
        unset($this->objects[$key]);

        return new Result([]);
    }

    /** @param array<string, string> $headers */
    private function doCopy(string $key, array $headers, ?string $md5): Result
    {
        $this->assertConsistent($headers, 'x-amz-copy-source-server-side-encryption-customer-');
        $source = rawurldecode($headers['x-amz-copy-source']);
        $sourceKey = substr(ltrim($source, '/'), strlen('bkt/'));
        $o = $this->open($sourceKey, $headers['x-amz-copy-source-server-side-encryption-customer-key-md5'] ?? null);
        if (isset($headers['x-amz-copy-source-if-match']) && $headers['x-amz-copy-source-if-match'] !== $o['etag']) {
            $this->fail(412, 'PreconditionFailed');
        }
        $this->put($key, $o['body'], $md5);

        return new Result(['CopyObjectResult' => ['ETag' => $this->objects[$key]['etag']]]);
    }
}
