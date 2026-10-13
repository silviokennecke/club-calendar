<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Exception\ApiProblemException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\EventListener\ErrorListener;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Validator\ConstraintViolationListInterface;
use Symfony\Component\Validator\Exception\ValidationFailedException;

#[AsEventListener(event: KernelEvents::EXCEPTION, priority: 50, method: 'onKernelException')]
class ExceptionListener
{
    public function __construct(
        private readonly ErrorListener $httpErrorListener,
        #[Autowire(param: 'kernel.project_dir')]
        private readonly string $projectDir = '',
    ) {
    }

    public function onKernelException(ExceptionEvent $event): void
    {
        $this->httpErrorListener->logKernelException($event);

        $exception = $event->getThrowable();

        if ($exception instanceof ValidationFailedException) {
            $violations = $exception->getViolations();
            $detail = $this->formatViolations($violations);
            $first = $violations->count() > 0 ? $violations->get(0)->getPropertyPath() : '';
            $extra = ['code' => 'validation_failed'] + ('' !== $first ? ['field' => $first] : []);
            $event->setResponse($this->problemResponse(422, 'Unprocessable Entity', $detail, $extra));

            return;
        }

        if ($exception instanceof ApiProblemException) {
            $status = $exception->getStatusCode();
            $extra = ['code' => $exception->getErrorCode()] + (null !== $exception->getField() ? ['field' => $exception->getField()] : []);
            $event->setResponse($this->problemResponse($status, $this->statusTitle($status), $exception->getMessage(), $extra, $exception->getHeaders()));

            return;
        }

        if ($exception instanceof HttpExceptionInterface) {
            $status = $exception->getStatusCode();
            $event->setResponse($this->problemResponse($status, $this->statusTitle($status), $this->publicDetail($exception, $status)));

            return;
        }

        // Symfony security exceptions not wrapped in HttpException
        if ($exception instanceof AccessDeniedException) {
            $event->setResponse($this->problemResponse(403, 'Forbidden', $this->publicDetail($exception, 403)));

            return;
        }

        if ($exception instanceof AuthenticationException) {
            $event->setResponse($this->problemResponse(401, 'Unauthorized', $this->publicDetail($exception, 401)));

            return;
        }

        // Unknown exception: 500
        $event->setResponse($this->problemResponse(500, 'Internal Server Error', 'An unexpected error occurred.'));
    }

    /**
     * Messages of exceptions thrown by the application itself are meant for clients ("Event not found").
     * Framework messages (entity resolver, router, ...) name internal classes and URLs: they are replaced
     * by the generic status title (the full message is still logged).
     */
    private function publicDetail(\Throwable $exception, int $status): string
    {
        $message = $exception->getMessage();
        $thrownByApp = '' !== $this->projectDir && str_starts_with($exception->getFile(), $this->projectDir.'/src/');
        if (!$thrownByApp || '' === $message || preg_match('/\w\\\\\w/', $message)) {
            return $this->statusTitle($status);
        }

        return $message;
    }

    /**
     * @param array<string, string> $extra   stable members such as `code` / `field` (RFC 7807 extensions)
     * @param array<string, string> $headers e.g. WWW-Authenticate of a 401
     */
    private function problemResponse(int $status, string $title, string $detail, array $extra = [], array $headers = []): JsonResponse
    {
        return new JsonResponse([
            'type' => 'https://tools.ietf.org/html/rfc2616#section-10',
            'title' => $title,
            'status' => $status,
            'detail' => $detail,
        ] + $extra, $status, ['Content-Type' => 'application/problem+json'] + $headers);
    }

    private function formatViolations(ConstraintViolationListInterface $violations): string
    {
        $parts = [];
        foreach ($violations as $violation) {
            $parts[] = $violation->getPropertyPath().': '.$violation->getMessage();
        }

        return implode('; ', $parts);
    }

    private function statusTitle(int $status): string
    {
        return match ($status) {
            400 => 'Bad Request',
            401 => 'Unauthorized',
            403 => 'Forbidden',
            404 => 'Not Found',
            405 => 'Method Not Allowed',
            409 => 'Conflict',
            413 => 'Content Too Large',
            422 => 'Unprocessable Entity',
            500 => 'Internal Server Error',
            503 => 'Service Unavailable',
            default => 'HTTP Error',
        };
    }
}
