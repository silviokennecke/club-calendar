<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Exception\ApiProblemException;
use App\Http\ProblemResponse;
use App\Security\JwtProblemListener;
use App\Service\Input;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\Exception\RequestExceptionInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\EventListener\ErrorListener;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Validator\ConstraintViolationListInterface;
use Symfony\Component\Validator\Exception\ValidationFailedException;

#[AsEventListener(event: KernelEvents::EXCEPTION, priority: 50, method: 'onKernelException')]
class ExceptionListener
{
    public function __construct(
        private readonly ErrorListener $httpErrorListener,
        private readonly ?TokenStorageInterface $tokenStorage = null,
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
            $event->setResponse($this->problemResponse(422, $detail, $extra));

            return;
        }

        if ($exception instanceof ApiProblemException) {
            $status = $exception->getStatusCode();
            $extra = ['code' => $exception->getErrorCode()] + (null !== $exception->getField() ? ['field' => $exception->getField()] : []);
            $event->setResponse($this->problemResponse($status, $exception->getMessage(), $extra, $exception->getHeaders()));

            return;
        }

        // A denied access check without a signed-in user (no Authorization header) is a missing authentication
        // (401), not a refusal (403): access_control of /api/clubs, /api/calendars and /api/map/geocode and the
        // member checks. The firewall may already have wrapped it into an AccessDeniedHttpException.
        if ($this->isAccessDenied($exception) && null === $this->tokenStorage?->getToken()?->getUser()) {
            $event->setResponse(JwtProblemListener::unauthorized(JwtProblemListener::MISSING_TOKEN_CODE, 'Not authenticated'));

            return;
        }

        if ($exception instanceof HttpExceptionInterface) {
            $status = $exception->getStatusCode();
            $extra = [];
            $detail = $this->publicDetail($exception, $status);
            $previous = $exception->getPrevious();
            if ($previous instanceof RequestExceptionInterface
                && preg_match('/^Input value "([^"]+)" contains a non-scalar value\.$/', $previous->getMessage(), $m)) {
                // `?from[]=x` where one value is expected (InputBag::get): an input error like all others
                $detail = sprintf('%s must be a single value', $m[1]);
                $extra = ['code' => Input::CODE, 'field' => $m[1]];
            } elseif (400 === $status) {
                // Every 400 carries a code: requests the framework rejects (malformed input) are invalid_request
                $extra = ['code' => 'invalid_request'];
            }
            $event->setResponse($this->problemResponse($status, $detail, $extra, $exception->getHeaders()));

            return;
        }

        // Symfony security exceptions not wrapped in HttpException
        if ($exception instanceof AccessDeniedException) {
            $event->setResponse($this->problemResponse(403, $this->publicDetail($exception, 403)));

            return;
        }

        if ($exception instanceof AuthenticationException) {
            $event->setResponse(JwtProblemListener::unauthorized(JwtProblemListener::INVALID_TOKEN_CODE, $this->publicDetail($exception, 401)));

            return;
        }

        // Unknown exception: 500
        $event->setResponse($this->problemResponse(500, 'An unexpected error occurred.'));
    }

    private function isAccessDenied(\Throwable $exception): bool
    {
        for ($e = $exception; null !== $e; $e = $e->getPrevious()) {
            if ($e instanceof AccessDeniedException) {
                return true;
            }
        }

        return false;
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
            return ProblemResponse::title($status);
        }

        return $message;
    }

    /**
     * @param array<string, string> $extra   stable members such as `code` / `field` (RFC 7807 extensions)
     * @param array<string, string> $headers e.g. WWW-Authenticate of a 401
     */
    private function problemResponse(int $status, string $detail, array $extra = [], array $headers = []): JsonResponse
    {
        return ProblemResponse::create($status, $detail, $extra, $headers);
    }

    private function formatViolations(ConstraintViolationListInterface $violations): string
    {
        $parts = [];
        foreach ($violations as $violation) {
            $parts[] = $violation->getPropertyPath().': '.$violation->getMessage();
        }

        return implode('; ', $parts);
    }
}
