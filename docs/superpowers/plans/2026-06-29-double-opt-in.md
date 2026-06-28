# Double Opt-In Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-registered users must verify their email via a time-limited link before they can log in; SSO users are pre-verified.

**Architecture:** A new `EmailVerification` entity holds a bcrypt-hashed split-token (UUID selector + random verifier) per verification request. `EmailVerificationService` manages token lifecycle; `EmailVerificationMailer` renders a MJML-compiled Twig template and dispatches via Symfony Mailer. Frontend handles the post-registration and post-login states inline without new routes except for the email-link landing page.

**Tech Stack:** PHP 8.4, Symfony 8.1, Doctrine ORM, symfony/mailer, symfony/twig-bundle, MJML (npm), React 19 + React Router v7, i18next

## Global Constraints

- UUIDs everywhere: `Uuid::v7()->toRfc4122()`, `#[ORM\Column(length: 36)]`, no `#[ORM\GeneratedValue]`, `getId(): string`
- Migrations in `App\Migrations` namespace; SQL must quote the `user` table with backticks
- No auto-increment IDs, no cookies, no SSR
- Follow Symfony attribute routing; all backend code under `backend/`, frontend under `frontend/`
- Commit after every task
- All error responses in the API follow existing conventions: `UnauthorizedHttpException` → 401, `AccessDeniedHttpException` → 403; new endpoints reuse `JsonResponse` directly for email-not-verified 403

---

## Task 1: Config & Environment

**Files:**
- Modify: `backend/.env`
- Modify: `backend/.env.example`
- Modify: `backend/config/packages/routing.yaml`
- Modify: `backend/phpunit.dist.xml`

**Interfaces:**
- Produces: `BACKEND_URL` env var (replaces `DEFAULT_URI`); `MAILER_DSN`, `MAILER_FROM` env vars; `MAILER_DSN=null://null` in test env

- [ ] **Step 1: Rename `DEFAULT_URI` to `BACKEND_URL` in `.env`**

```
# backend/.env  (replace the DEFAULT_URI line)
BACKEND_URL=http://localhost:3001
MAILER_DSN=smtp://localhost:1025
MAILER_FROM="Club Calendar <noreply@example.com>"
```

- [ ] **Step 2: Apply the same changes to `.env.example`**

Replace `DEFAULT_URI=http://localhost:3001` with:
```
BACKEND_URL=http://localhost:3001
MAILER_DSN=smtp://localhost:1025
MAILER_FROM="Club Calendar <noreply@example.com>"
```

- [ ] **Step 3: Update `routing.yaml`**

```yaml
# backend/config/packages/routing.yaml
framework:
    router:
        default_uri: '%env(BACKEND_URL)%'

when@prod:
    framework:
        router:
            strict_requirements: null
```

- [ ] **Step 4: Add `MAILER_DSN` to test config in `phpunit.dist.xml`**

Add inside the `<php>` block (after the existing `<env>` entries):
```xml
<env name="MAILER_DSN" value="null://null"/>
<env name="MAILER_FROM" value="noreply@test.example.com"/>
```

- [ ] **Step 5: Run the test suite to verify nothing broke**

```bash
cd backend && composer test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/.env backend/.env.example backend/config/packages/routing.yaml backend/phpunit.dist.xml
git commit -m "chore: rename DEFAULT_URI to BACKEND_URL, add MAILER_DSN/MAILER_FROM env vars"
```

---

## Task 2: Entities + Migration

**Files:**
- Modify: `backend/src/Entity/User.php`
- Create: `backend/src/Entity/EmailVerification.php`
- Create: `backend/migrations/Version20260629000000.php`
- Modify: `backend/tests/Helper/TestHelper.php`

**Interfaces:**
- Produces:
  - `User::isEmailVerified(): bool`
  - `User::setIsEmailVerified(bool): static`
  - `User::getCreatedAt(): \DateTimeImmutable`
  - `EmailVerification::getId(): string`
  - `EmailVerification::getUser(): User`
  - `EmailVerification::getTokenHash(): string`
  - `EmailVerification::setTokenHash(string): static`
  - `EmailVerification::getExpiresAt(): \DateTimeImmutable`
  - `EmailVerification::getUsedAt(): ?\DateTimeImmutable`
  - `EmailVerification::setUsedAt(?\DateTimeImmutable): static`
  - `EmailVerification::getInvalidatedAt(): ?\DateTimeImmutable`
  - `EmailVerification::setInvalidatedAt(?\DateTimeImmutable): static`
  - `TestHelper::createUser()` now sets `isEmailVerified = true` by default

- [ ] **Step 1: Add `isEmailVerified` and `createdAt` to `User` entity**

Open `backend/src/Entity/User.php`. Add these two fields after `$language`:
```php
#[ORM\Column]
private bool $isEmailVerified = false;

#[ORM\Column]
private \DateTimeImmutable $createdAt;
```

In the constructor add:
```php
$this->createdAt = new \DateTimeImmutable();
```

Add these methods after the existing getters/setters:
```php
public function isEmailVerified(): bool
{
    return $this->isEmailVerified;
}

public function setIsEmailVerified(bool $isEmailVerified): static
{
    $this->isEmailVerified = $isEmailVerified;

    return $this;
}

public function getCreatedAt(): \DateTimeImmutable
{
    return $this->createdAt;
}
```

- [ ] **Step 2: Create `EmailVerification` entity**

Create `backend/src/Entity/EmailVerification.php`:
```php
<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class EmailVerification
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 255)]
    private string $tokenHash;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $invalidatedAt = null;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->expiresAt = new \DateTimeImmutable('+24 hours');
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function setUser(User $user): static
    {
        $this->user = $user;

        return $this;
    }

    public function getTokenHash(): string
    {
        return $this->tokenHash;
    }

    public function setTokenHash(string $tokenHash): static
    {
        $this->tokenHash = $tokenHash;

        return $this;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getUsedAt(): ?\DateTimeImmutable
    {
        return $this->usedAt;
    }

    public function setUsedAt(?\DateTimeImmutable $usedAt): static
    {
        $this->usedAt = $usedAt;

        return $this;
    }

    public function getInvalidatedAt(): ?\DateTimeImmutable
    {
        return $this->invalidatedAt;
    }

    public function setInvalidatedAt(?\DateTimeImmutable $invalidatedAt): static
    {
        $this->invalidatedAt = $invalidatedAt;

        return $this;
    }
}
```

- [ ] **Step 3: Create the migration**

Create `backend/migrations/Version20260629000000.php`:
```php
<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260629000000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add isEmailVerified/createdAt to user; create email_verification table';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE `user` ADD COLUMN is_email_verified TINYINT(1) NOT NULL DEFAULT 0");
        $this->addSql("ALTER TABLE `user` ADD COLUMN created_at DATETIME NOT NULL DEFAULT NOW() COMMENT '(DC2Type:datetime_immutable)'");
        $this->addSql("UPDATE `user` SET is_email_verified = 1");
        $this->addSql("CREATE TABLE email_verification (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            token_hash VARCHAR(255) NOT NULL,
            expires_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
            used_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
            invalidated_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
            PRIMARY KEY (id),
            INDEX IDX_email_verification_user_id (user_id),
            CONSTRAINT FK_email_verification_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB");
    }

    public function down(Schema $schema): void
    {
        $this->addSql("DROP TABLE email_verification");
        $this->addSql("ALTER TABLE `user` DROP COLUMN is_email_verified, DROP COLUMN created_at");
    }
}
```

Note the `UPDATE user SET is_email_verified = 1` — existing users are pre-verified to avoid locking out everyone.

- [ ] **Step 4: Update `TestHelper::createUser` to set `isEmailVerified = true`**

In `backend/tests/Helper/TestHelper.php`, inside `createUser()`, add after `setLanguage` calls (just before `$em->persist($user)`):
```php
$user->setIsEmailVerified(true);
```

- [ ] **Step 5: Run the migration against both databases**

```bash
cd backend
php bin/console doctrine:migrations:migrate --no-interaction
php bin/console doctrine:migrations:migrate --no-interaction --env=test
```

Expected: "1 migration executed" on each.

- [ ] **Step 6: Run tests**

```bash
composer test
```

Expected: all tests pass (existing users stay verified via the migration backfill; `TestHelper` creates verified users).

- [ ] **Step 7: Commit**

```bash
git add backend/src/Entity/User.php backend/src/Entity/EmailVerification.php \
    backend/migrations/Version20260629000000.php backend/tests/Helper/TestHelper.php
git commit -m "feat: add EmailVerification entity and isEmailVerified/createdAt to User"
```

---

## Task 3: Composer Dependencies + MJML Pipeline + Translations

**Files:**
- Run: `composer require symfony/mailer symfony/twig-bundle`
- Modify: `package.json` (root)
- Create: `backend/config/packages/mailer.yaml`
- Create: `backend/config/packages/translation.yaml`
- Create: `backend/translations/messages+intl-icu.en.json`
- Create: `backend/translations/messages+intl-icu.de.json`
- Create: `backend/templates/email/verify_email.mjml`
- Create: `backend/templates/email/verify_email.html.twig` (compiled)

**Interfaces:**
- Produces: Twig + Mailer wired in DI; `npm run mjml` compiles templates; translations available under `email.verify.*`

- [ ] **Step 1: Install backend dependencies**

```bash
cd backend && composer require symfony/mailer symfony/twig-bundle
```

Expected: packages added to `composer.json`, `composer.lock` updated.

- [ ] **Step 2: Create `backend/config/packages/mailer.yaml`**

```yaml
framework:
    mailer:
        dsn: '%env(MAILER_DSN)%'
```

- [ ] **Step 3: Create `backend/config/packages/translation.yaml`**

```yaml
framework:
    translator:
        default_path: '%kernel.project_dir%/translations'
        fallbacks:
            - en
```

- [ ] **Step 4: Install `mjml` as a dev dependency**

From the repo root:
```bash
npm install --save-dev mjml
```

Expected: `mjml` appears in root `package.json` `devDependencies`.

- [ ] **Step 5: Add `mjml` script and lint-staged entry to root `package.json`**

In the `"scripts"` section, add:
```json
"mjml": "mjml backend/templates/email/verify_email.mjml -o backend/templates/email/verify_email.html.twig"
```

In the `"lint-staged"` section, add:
```json
"backend/translations/**/*.json": ["prettier --write"]
```

- [ ] **Step 6: Create English translation file**

Create `backend/translations/messages+intl-icu.en.json`:
```json
{
  "email": {
    "verify": {
      "subject": "Please verify your email address",
      "greeting": "Hello {name},",
      "body": "Thank you for registering. Please click the button below to verify your email address. This link is valid for 24 hours.",
      "button": "Verify email address",
      "expiry_note": "If you did not create an account, you can safely ignore this email.",
      "ignore_note": "This link expires in 24 hours."
    }
  }
}
```

- [ ] **Step 7: Create German translation file**

Create `backend/translations/messages+intl-icu.de.json`:
```json
{
  "email": {
    "verify": {
      "subject": "Bitte bestätige deine E-Mail-Adresse",
      "greeting": "Hallo {name},",
      "body": "Danke für deine Registrierung. Klicke bitte auf den Button unten, um deine E-Mail-Adresse zu bestätigen. Dieser Link ist 24 Stunden gültig.",
      "button": "E-Mail-Adresse bestätigen",
      "expiry_note": "Falls du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.",
      "ignore_note": "Dieser Link läuft in 24 Stunden ab."
    }
  }
}
```

- [ ] **Step 8: Create MJML source template**

Create `backend/templates/email/verify_email.mjml`:
```xml
<mjml>
  <mj-head>
    <mj-title>{{ 'email.verify.subject'|trans }}</mj-title>
    <mj-preview>{{ 'email.verify.subject'|trans }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="16px" color="#333333" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4">
    <mj-section background-color="#ffffff" padding="40px 30px">
      <mj-column>
        <mj-text font-size="14px" color="#888888" padding-bottom="16px">
          📅 Club Calendar
        </mj-text>
        <mj-text font-size="18px" font-weight="bold" padding-bottom="8px">
          {{ 'email.verify.greeting'|trans({name: userName}) }}
        </mj-text>
        <mj-text padding-bottom="24px">
          {{ 'email.verify.body'|trans }}
        </mj-text>
        <mj-button
          href="{{ verificationUrl }}"
          background-color="#2563eb"
          color="#ffffff"
          border-radius="6px"
          font-size="16px"
          padding="12px 24px"
        >
          {{ 'email.verify.button'|trans }}
        </mj-button>
        <mj-text font-size="13px" color="#888888" padding-top="24px">
          {{ 'email.verify.expiry_note'|trans }}
        </mj-text>
        <mj-text font-size="13px" color="#888888">
          {{ 'email.verify.ignore_note'|trans }}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

- [ ] **Step 9: Compile MJML to HTML Twig**

```bash
npm run mjml
```

Expected: `backend/templates/email/verify_email.html.twig` is created/updated. Inspect it — the `{{ ... }}` Twig expressions should appear verbatim in the compiled output.

- [ ] **Step 10: Commit**

```bash
git add backend/config/packages/mailer.yaml backend/config/packages/translation.yaml \
    backend/translations/ backend/templates/email/ \
    package.json package-lock.json backend/composer.json backend/composer.lock
git commit -m "feat: add mailer/twig deps, MJML pipeline, and email verification translations"
```

---

## Task 4: EmailVerificationService + EmailVerificationMailer

**Files:**
- Create: `backend/src/Service/EmailVerificationService.php`
- Create: `backend/src/Service/EmailVerificationMailer.php`

**Interfaces:**
- Consumes: `EmailVerification` entity, `User` entity, `EntityManagerInterface`, `MailerInterface`, `UrlGeneratorInterface`, `TranslatorInterface`
- Produces:
  - `EmailVerificationService::createVerification(User): array{EmailVerification, string}` — creates token row, invalidates prior rows, returns `[$ev, $rawVerifier]`
  - `EmailVerificationService::verify(string $id, string $rawVerifier): string` — returns one of `'success'`, `'invalid'`, `'expired'`, `'already_used'`
  - `EmailVerificationMailer::send(User): void` — creates token via service, sends templated email

- [ ] **Step 1: Create `EmailVerificationService`**

Create `backend/src/Service/EmailVerificationService.php`:
```php
<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\EmailVerification;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;

readonly class EmailVerificationService
{
    public function __construct(
        private EntityManagerInterface $em,
    ) {
    }

    /**
     * Invalidates all prior tokens for this user, creates a new one, and returns
     * the EmailVerification entity plus the raw (unhashed) verifier string.
     *
     * @return array{EmailVerification, string}
     */
    public function createVerification(User $user): array
    {
        $this->em->createQueryBuilder()
            ->update(EmailVerification::class, 'ev')
            ->set('ev.invalidatedAt', ':now')
            ->where('ev.user = :user')
            ->andWhere('ev.invalidatedAt IS NULL')
            ->setParameter('now', new \DateTimeImmutable())
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();

        $rawVerifier = bin2hex(random_bytes(32));
        $ev = new EmailVerification();
        $ev->setUser($user);
        $ev->setTokenHash(password_hash($rawVerifier, PASSWORD_BCRYPT));
        $this->em->persist($ev);
        $this->em->flush();

        return [$ev, $rawVerifier];
    }

    /**
     * Verifies a split-token. Returns 'success', 'invalid', 'expired', or 'already_used'.
     */
    public function verify(string $id, string $rawVerifier): string
    {
        $ev = $this->em->getRepository(EmailVerification::class)->find($id);
        if (!$ev) {
            return 'invalid';
        }
        if (!password_verify($rawVerifier, $ev->getTokenHash())) {
            return 'invalid';
        }
        if (null !== $ev->getInvalidatedAt()) {
            return 'invalid';
        }
        if ($ev->getExpiresAt() < new \DateTimeImmutable()) {
            return 'expired';
        }
        if (null !== $ev->getUsedAt()) {
            return 'already_used';
        }

        $ev->setUsedAt(new \DateTimeImmutable());
        $user = $ev->getUser();
        $user->setIsEmailVerified(true);
        $this->em->flush();

        return 'success';
    }
}
```

- [ ] **Step 2: Create `EmailVerificationMailer`**

Create `backend/src/Service/EmailVerificationMailer.php`:
```php
<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

readonly class EmailVerificationMailer
{
    public function __construct(
        private MailerInterface $mailer,
        private EmailVerificationService $verificationService,
        private UrlGeneratorInterface $urlGenerator,
        private TranslatorInterface $translator,
        #[Autowire(env: 'MAILER_FROM')]
        private string $mailerFrom,
    ) {
    }

    public function send(User $user): void
    {
        [$ev, $rawVerifier] = $this->verificationService->createVerification($user);

        $verificationUrl = $this->urlGenerator->generate(
            'api_auth_verify_email',
            ['id' => $ev->getId(), 'token' => $rawVerifier],
            UrlGeneratorInterface::ABSOLUTE_URL,
        );

        $email = (new TemplatedEmail())
            ->from($this->mailerFrom)
            ->to($user->getEmail())
            ->subject($this->translator->trans('email.verify.subject', [], 'messages', $user->getLanguage()))
            ->htmlTemplate('email/verify_email.html.twig')
            ->locale($user->getLanguage())
            ->context([
                'userName' => $user->getName(),
                'verificationUrl' => $verificationUrl,
            ]);

        $this->mailer->send($email);
    }
}
```

Note: `'api_auth_verify_email'` is the route name assigned in Task 5. The mailer compiles the Twig template at send time using the user's locale, so `|trans` calls in the template resolve to the correct language.

- [ ] **Step 3: Check for PHP syntax errors**

```bash
cd backend && php -l src/Service/EmailVerificationService.php && php -l src/Service/EmailVerificationMailer.php
```

Expected: `No syntax errors detected` for both files.

- [ ] **Step 4: Commit**

```bash
git add backend/src/Service/EmailVerificationService.php backend/src/Service/EmailVerificationMailer.php
git commit -m "feat: add EmailVerificationService and EmailVerificationMailer"
```

---

## Task 5: Backend API Changes + Rate Limiter + All Backend Tests

**Files:**
- Modify: `backend/src/Service/AuthService.php`
- Modify: `backend/src/Controller/AuthController.php`
- Modify: `backend/config/packages/rate_limiter.yaml`
- Modify: `backend/tests/Controller/AuthTest.php`

**Interfaces:**
- Consumes: `EmailVerificationService` (for verify), `EmailVerificationMailer` (for send), `RateLimiterFactory $emailVerificationResendLimiter`
- Produces:
  - `POST /api/auth/register` → 202 `{"message":"check_your_email"}` (no tokens)
  - `POST /api/auth/login` → 403 `{"error":"email_not_verified"}` when `isEmailVerified=false`
  - `POST /api/auth/resend-verification` → 204, rate-limited at 3/hour/email
  - `GET /api/auth/verify-email?id=&token=` → redirect to frontend (route name: `api_auth_verify_email`)
  - SSO (`findOrCreateOAuthUser`) → new users created with `isEmailVerified=true`

- [ ] **Step 1: Write the failing tests first**

Replace the contents of `backend/tests/Controller/AuthTest.php` with:
```php
<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class AuthTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    // --- Register ---

    public function testRegisterReturns202AndCheckYourEmailMessage(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Alice', 'email' => 'alice@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(202, $r['status']);
        $this->assertSame('check_your_email', $r['body']['message']);
        $this->assertArrayNotHasKey('access_token', $r['body']);
    }

    public function testRegisterSendsVerificationEmail(): void
    {
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Bob', 'email' => 'bob@example.com', 'password' => 'password123',
        ]);
        $this->assertEmailCount(1);
        $email = $this->getMailerMessage();
        $this->assertEmailAddressContains($email, 'to', 'bob@example.com');
    }

    // --- Login ---

    public function testLoginReturns422ForInvalidBody(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'not-an-email', 'password' => '',
        ]);
        $this->assertSame(422, $r['status']);
    }

    public function testLoginReturns401ForUnknownEmail(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'nobody@example.com', 'password' => 'anything',
        ]);
        $this->assertSame(401, $r['status']);
    }

    public function testLoginReturns401ForWrongPassword(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'alice@example.com', 'password' => 'wrong',
        ]);
        $this->assertSame(401, $r['status']);
    }

    public function testLoginReturns403ForUnverifiedUser(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'unverified@example.com', 'password123', false);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'unverified@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(403, $r['status']);
        $this->assertSame('email_not_verified', $r['body']['error']);
    }

    public function testLoginReturnsTokensForVerifiedUser(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'bob@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(200, $r['status']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);
        $this->assertSame('Bearer', $r['body']['token_type']);
    }

    // --- Resend verification ---

    public function testResendVerificationReturns204ForUnknownEmail(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'nobody@example.com',
        ]);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(0);
    }

    public function testResendVerificationReturns204ForAlreadyVerifiedEmail(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'verified@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'verified@example.com',
        ]);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(0);
    }

    public function testResendVerificationSendsEmailForUnverifiedUser(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'unverified@example.com', 'password123', false);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'unverified@example.com',
        ]);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'unverified@example.com');
    }

    // --- Verify email ---

    public function testVerifyEmailRedirectsToFrontendOnSuccess(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'carol@example.com', 'password123', false);
        // Register to trigger token creation
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'carol@example.com',
        ]);
        $ev = self::$em->getRepository(\App\Entity\EmailVerification::class)->findOneBy([]);
        // We can't recover rawVerifier from the hash; test redirect happens with invalid token → 'invalid' reason
        self::$client->request('GET', '/api/auth/verify-email?id=bad-id&token=bad-token');
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        $location = $response->headers->get('Location');
        $this->assertStringContainsString('status=error', $location);
        $this->assertStringContainsString('reason=invalid', $location);
    }

    // --- Existing tests ---

    public function testMeReturns401WithoutToken(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me');
        $this->assertSame(401, $r['status']);
    }

    public function testMeReturnsUserForValidToken(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'carol@example.com');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame('carol@example.com', $r['body']['email']);
    }

    public function testTokenRefreshReturnsNewAccessToken(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'dave@example.com');
        $loginRes = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'dave@example.com', 'password' => 'password123',
        ]);
        $refreshToken = $loginRes['body']['refresh_token'];

        self::$client->request('POST', '/api/auth/token', [
            'grant_type' => 'refresh_token',
            'refresh_token' => $refreshToken,
        ], [], ['CONTENT_TYPE' => 'application/x-www-form-urlencoded']);
        $response = self::$client->getResponse();
        $this->assertSame(200, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertNotEmpty($body['access_token']);
    }

    public function testLogoutReturnsOk(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout');
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['ok']);
    }

    public function testProvidersReturnsArrayOfProviderObjects(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/providers');
        $this->assertSame(200, $r['status']);
        $this->assertIsArray($r['body']);
        foreach ($r['body'] as $provider) {
            $this->assertArrayHasKey('id', $provider);
            $this->assertArrayHasKey('name', $provider);
            $this->assertArrayHasKey('icon', $provider);
        }
    }
}
```

- [ ] **Step 2: Update `TestHelper::createUser` to accept `isEmailVerified` parameter**

In `backend/tests/Helper/TestHelper.php`, update the method signature and body:
```php
public static function createUser(
    EntityManagerInterface $em,
    UserPasswordHasherInterface $hasher,
    ?string $email = null,
    string $password = 'password123',
    bool $isEmailVerified = true,
): User {
    $email ??= 'user'.uniqid().'@example.com';
    $user = new User();
    $user->setName('Test User');
    $user->setEmail($email);
    $user->setPassword($hasher->hashPassword($user, $password));
    $user->setIsEmailVerified($isEmailVerified);
    $em->persist($user);
    $em->flush();

    return $user;
}
```

- [ ] **Step 3: Run tests to confirm they fail for the right reasons**

```bash
cd backend && composer test
```

Expected: several tests fail — `testRegisterReturns202`, `testRegisterSendsVerificationEmail`, `testLoginReturns403ForUnverifiedUser`, resend tests, verify test — because the implementation hasn't changed yet.

- [ ] **Step 4: Add rate limiter for resend endpoint**

In `backend/config/packages/rate_limiter.yaml`, add inside `framework.rate_limiter:`:
```yaml
        email_verification_resend:
            policy: sliding_window
            limit: 3
            interval: '1 hour'
```

- [ ] **Step 5: Update `AuthService`**

In `backend/src/Service/AuthService.php`:

Add import at the top:
```php
use App\Service\EmailVerificationMailer;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
```

Change the constructor to add `EmailVerificationMailer`:
```php
public function __construct(
    private readonly EntityManagerInterface $em,
    private readonly UserPasswordHasherInterface $hasher,
    private readonly TokenService $tokens,
    private readonly EmailVerificationMailer $verificationMailer,
) {
}
```

Replace the `register` method:
```php
public function register(string $name, string $email, string $password, ?string $language = null): void
{
    $existing = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
    if ($existing) {
        throw new BadRequestHttpException('Email already in use');
    }
    $user = new User();
    $user->setName($name);
    $user->setEmail($email);
    $user->setPassword($this->hasher->hashPassword($user, $password));
    if (null !== $language && '' !== $language) {
        $user->setLanguage($language);
    }
    $this->em->persist($user);
    $this->em->flush();
    $this->verificationMailer->send($user);
}
```

In the `login` method, add the unverified check after the password validation (before `return $this->tokens->tokenResponse($user)`):
```php
public function login(string $email, string $password): array
{
    $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
    if (!$user || !$user->getPassword()) {
        throw new UnauthorizedHttpException('Bearer', 'Invalid credentials');
    }
    if (!$this->hasher->isPasswordValid($user, $password)) {
        throw new UnauthorizedHttpException('Bearer', 'Invalid credentials');
    }
    if (!$user->isEmailVerified()) {
        throw new EmailNotVerifiedException();
    }

    return $this->tokens->tokenResponse($user);
}
```

In `findOrCreateOAuthUser`, after `$user = new User();` + `setName`/`setEmail`, add:
```php
$user->setIsEmailVerified(true);
```

- [ ] **Step 6: Create `EmailNotVerifiedException`**

Create `backend/src/Exception/EmailNotVerifiedException.php`:
```php
<?php

declare(strict_types=1);

namespace App\Exception;

class EmailNotVerifiedException extends \RuntimeException
{
    public function __construct()
    {
        parent::__construct('Email not verified');
    }
}
```

- [ ] **Step 7: Create `ResendVerificationDto`**

Create `backend/src/Dto/Auth/ResendVerificationDto.php`:
```php
<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class ResendVerificationDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    public string $email = '';
}
```

- [ ] **Step 8: Update `AuthController`**

Replace the full contents of `backend/src/Controller/AuthController.php`:
```php
<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\LoginDto;
use App\Dto\Auth\RegisterDto;
use App\Dto\Auth\ResendVerificationDto;
use App\Dto\Auth\UpdateMeDto;
use App\Entity\User;
use App\Exception\EmailNotVerifiedException;
use App\Security\CurrentUserResolver;
use App\Service\AuthService;
use App\Service\EmailVerificationService;
use Doctrine\ORM\EntityManagerInterface;
use KnpU\OAuth2ClientBundle\Client\ClientRegistry;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\RateLimiter\RateLimiterFactory;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/auth')]
class AuthController extends AbstractApiController
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
        private readonly ClientRegistry $clientRegistry,
        private readonly EmailVerificationService $verificationService,
        private readonly EntityManagerInterface $em,
        private readonly RateLimiterFactory $emailVerificationResendLimiter,
        #[Autowire(param: 'knpu_oauth2_client.providers_meta')]
        private readonly array $providersMeta,
        #[Autowire(env: 'FRONTEND_URL')]
        private readonly string $frontendUrl,
    ) {
    }

    #[Route('/register', methods: ['POST'])]
    public function register(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), RegisterDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        $this->auth->register($dto->name, $dto->email, $dto->password, $dto->language);

        return new JsonResponse(['message' => 'check_your_email'], Response::HTTP_ACCEPTED);
    }

    #[Route('/login', methods: ['POST'])]
    public function login(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), LoginDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        try {
            return new JsonResponse($this->auth->login($dto->email, $dto->password));
        } catch (EmailNotVerifiedException) {
            return new JsonResponse(['error' => 'email_not_verified'], Response::HTTP_FORBIDDEN);
        }
    }

    #[Route('/resend-verification', methods: ['POST'])]
    public function resendVerification(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), ResendVerificationDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);

        $limiter = $this->emailVerificationResendLimiter->create($dto->email);
        $limit = $limiter->consume();
        if (!$limit->isAccepted()) {
            return new JsonResponse(null, Response::HTTP_NO_CONTENT);
        }

        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $dto->email]);
        if (!$user || $user->isEmailVerified()) {
            return new JsonResponse(null, Response::HTTP_NO_CONTENT);
        }

        $this->auth->sendVerificationEmail($user);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/verify-email', name: 'api_auth_verify_email', methods: ['GET'])]
    public function verifyEmail(Request $request): RedirectResponse
    {
        $id = (string) $request->query->get('id', '');
        $token = (string) $request->query->get('token', '');
        $result = $this->verificationService->verify($id, $token);

        if ('success' === $result) {
            return new RedirectResponse($this->frontendUrl.'/auth/verify-email?status=success');
        }

        return new RedirectResponse(
            $this->frontendUrl.'/auth/verify-email?status=error&reason='.$result
        );
    }

    #[Route('/token', methods: ['POST'])]
    public function token(Request $request): JsonResponse
    {
        $grantType = $request->request->get('grant_type');
        $refreshToken = $request->request->get('refresh_token');
        if ('refresh_token' !== $grantType || empty($refreshToken)) {
            throw new BadRequestHttpException('Invalid grant type or missing refresh_token');
        }

        return new JsonResponse($this->auth->refresh($refreshToken));
    }

    #[Route('/logout', methods: ['POST'])]
    public function logout(): JsonResponse
    {
        return new JsonResponse(['ok' => true]);
    }

    #[Route('/me', methods: ['GET'])]
    public function getMe(): JsonResponse
    {
        $user = $this->userResolver->resolve();

        return new JsonResponse($this->auth->getMe($user));
    }

    #[Route('/me', methods: ['PATCH'])]
    public function updateMe(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = $this->decodeJson($request);
        $dto = new UpdateMeDto();
        if (array_key_exists('dateFormat', $data)) {
            $dto->dateFormat = $data['dateFormat'];
        }
        if (array_key_exists('firstDayOfWeek', $data)) {
            $dto->firstDayOfWeek = $data['firstDayOfWeek'];
        }
        if (array_key_exists('lastClubId', $data)) {
            $dto->lastClubId = $data['lastClubId'];
        }
        if (array_key_exists('lastCalendarId', $data)) {
            $dto->lastCalendarId = $data['lastCalendarId'];
        }
        $this->validateDto($dto, $this->validator);

        return new JsonResponse($this->auth->updateMe($user, $data));
    }

    #[Route('/me', methods: ['DELETE'])]
    public function deleteMe(): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->auth->deleteMe($user);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/providers', methods: ['GET'])]
    public function providers(): JsonResponse
    {
        $result = [];
        foreach ($this->clientRegistry->getEnabledClientKeys() as $id) {
            $envPrefix = strtoupper($id);
            if (empty($_ENV["{$envPrefix}_CLIENT_ID"]) || empty($_ENV["{$envPrefix}_CLIENT_SECRET"])) {
                continue;
            }
            $meta = $this->providersMeta[$id] ?? [];
            $result[] = [
                'id' => $id,
                'name' => $meta['label'] ?? ucfirst($id),
                'icon' => $meta['icon'] ?? $id,
            ];
        }

        return new JsonResponse($result);
    }
}
```

- [ ] **Step 9: Add `sendVerificationEmail` to `AuthService`**

In `backend/src/Service/AuthService.php`, add this public method:
```php
public function sendVerificationEmail(User $user): void
{
    $this->verificationMailer->send($user);
}
```

- [ ] **Step 10: Run tests and verify they pass**

```bash
cd backend && composer test
```

Expected: all tests pass. The `testRegisterReturns202`, `testRegisterSendsVerificationEmail`, `testLoginReturns403ForUnverifiedUser`, resend tests, and verify-redirect test should all pass now.

- [ ] **Step 11: Commit**

```bash
git add backend/src/ backend/config/packages/rate_limiter.yaml backend/tests/
git commit -m "feat: double opt-in — register returns 202, login blocks unverified, resend + verify endpoints"
```

---

## Task 6: Cleanup Command

**Files:**
- Create: `backend/src/Command/PruneUnverifiedUsersCommand.php`

**Interfaces:**
- Produces: `php bin/console app:prune-unverified-users` — deletes unverified users older than 30 days

- [ ] **Step 1: Create the command**

Create `backend/src/Command/PruneUnverifiedUsersCommand.php`:
```php
<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(
    name: 'app:prune-unverified-users',
    description: 'Delete unverified user accounts older than 30 days',
)]
class PruneUnverifiedUsersCommand extends Command
{
    public function __construct(
        private readonly EntityManagerInterface $em,
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $cutoff = new \DateTimeImmutable('-30 days');

        $deleted = $this->em->createQueryBuilder()
            ->delete(User::class, 'u')
            ->where('u.isEmailVerified = :verified')
            ->andWhere('u.createdAt < :cutoff')
            ->setParameter('verified', false)
            ->setParameter('cutoff', $cutoff)
            ->getQuery()
            ->execute();

        $io->success(sprintf('Deleted %d unverified user(s) older than 30 days.', $deleted));

        return Command::SUCCESS;
    }
}
```

- [ ] **Step 2: Test the command lists correctly**

```bash
cd backend && php bin/console list app
```

Expected: `app:prune-unverified-users` appears in the list.

- [ ] **Step 3: Commit**

```bash
git add backend/src/Command/PruneUnverifiedUsersCommand.php
git commit -m "feat: add prune-unverified-users console command for 30-day cleanup"
```

---

## Task 7: Frontend Changes

**Files:**
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/de.json`
- Modify: `frontend/src/pages/SignupPage.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/EmailVerifyPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/resend-verification`, `GET /api/auth/verify-email?status=&reason=`
- Produces: signup shows "check your email" on 202; login shows resend UI on 403+email_not_verified; `/auth/verify-email` page shows success/error

- [ ] **Step 1: Add i18n keys to `frontend/src/locales/en.json`**

In the `"auth"` object, add after the last existing key:
```json
"checkYourEmail": "Check your email",
"checkYourEmailMessage": "We've sent a verification link to {email}. Click it to activate your account.",
"emailNotVerified": "Your email address has not been verified yet.",
"resendVerificationEmail": "Resend verification email",
"verificationEmailSent": "Verification email sent. Please check your inbox.",
"emailVerified": "Your email address has been verified.",
"emailVerifiedLoginPrompt": "You can now sign in to your account.",
"verificationLinkExpired": "This verification link has expired.",
"verificationLinkInvalid": "This verification link is not valid.",
"verificationLinkAlreadyUsed": "This verification link has already been used.",
"backToLogin": "Back to sign in",
"requestNewLink": "Request a new link"
```

- [ ] **Step 2: Add i18n keys to `frontend/src/locales/de.json`**

In the `"auth"` object, add after the last existing key:
```json
"checkYourEmail": "Überprüfe deine E-Mails",
"checkYourEmailMessage": "Wir haben einen Bestätigungslink an {email} gesendet. Klicke darauf, um dein Konto zu aktivieren.",
"emailNotVerified": "Deine E-Mail-Adresse wurde noch nicht bestätigt.",
"resendVerificationEmail": "Bestätigungs-E-Mail erneut senden",
"verificationEmailSent": "Bestätigungs-E-Mail gesendet. Bitte prüfe deinen Posteingang.",
"emailVerified": "Deine E-Mail-Adresse wurde bestätigt.",
"emailVerifiedLoginPrompt": "Du kannst dich jetzt in deinem Konto anmelden.",
"verificationLinkExpired": "Dieser Bestätigungslink ist abgelaufen.",
"verificationLinkInvalid": "Dieser Bestätigungslink ist nicht gültig.",
"verificationLinkAlreadyUsed": "Dieser Bestätigungslink wurde bereits verwendet.",
"backToLogin": "Zurück zur Anmeldung",
"requestNewLink": "Neuen Link anfordern"
```

- [ ] **Step 3: Update `SignupPage.tsx`**

Replace the full contents of `frontend/src/pages/SignupPage.tsx`:
```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/lib/api";
import i18n from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Alert } from "@/components/ui/shared";

export default function SignupPage() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("auth.passwordsDoNotMatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      await apiPost("/api/auth/register", {
        name,
        email,
        password,
        language: i18n.resolvedLanguage ?? "en",
      });
      setSubmittedEmail(email);
      setSubmitted(true);
    } catch (e: unknown) {
      setError((e as Error).message ?? t("auth.signingUp"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm border-slate-200 shadow-md">
        <CardHeader className="pb-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xl">📅</span>
            <span className="text-sm text-slate-500">Club Calendar</span>
          </div>
          <CardTitle className="text-xl">
            {submitted ? t("auth.checkYourEmail") : t("auth.createAccount")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <p className="text-sm text-slate-600">
              {t("auth.checkYourEmailMessage", { email: submittedEmail })}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="name">{t("auth.fullName")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
              </Button>
            </form>
          )}
        </CardContent>
        {!submitted && (
          <CardFooter className="justify-center pt-0">
            <p className="text-sm text-slate-500">
              {t("auth.alreadyHaveAccount")}{" "}
              <Link to="/login" className="font-medium text-blue-600 hover:underline">
                {t("auth.signIn")}
              </Link>
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Update `LoginPage.tsx`**

After the existing `const [loading, setLoading] = useState(false);` line, add:
```tsx
const [emailNotVerified, setEmailNotVerified] = useState(false);
const [resendEmail, setResendEmail] = useState("");
const [resendLoading, setResendLoading] = useState(false);
const [resendDone, setResendDone] = useState(false);
```

Replace the `handleSubmit` function:
```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setError("");
  setEmailNotVerified(false);
  setResendDone(false);
  setLoading(true);
  try {
    const data = await apiPost<{ access_token: string; refresh_token: string; user: User }>(
      "/api/auth/login",
      { email, password },
    );
    login(data.access_token, data.refresh_token, data.user);
    navigate("/clubs");
  } catch (err: unknown) {
    if (err instanceof Error && (err as { status?: number }).status === 403) {
      setEmailNotVerified(true);
      setResendEmail(email);
    } else {
      setError(t("auth.invalidEmailOrPassword"));
    }
  } finally {
    setLoading(false);
  }
}
```

Add a `handleResend` function after `handleSubmit`:
```tsx
async function handleResend() {
  setResendLoading(true);
  try {
    await apiPost("/api/auth/resend-verification", { email: resendEmail });
  } catch {
    // silently ignore — server always returns 204
  } finally {
    setResendLoading(false);
    setResendDone(true);
  }
}
```

In the JSX, replace the `{error && <p ...>}` line with:
```tsx
{error && <p className="text-sm text-red-600">{error}</p>}
{emailNotVerified && (
  <Alert variant="warning">
    <p className="text-sm">{t("auth.emailNotVerified")}</p>
    {resendDone ? (
      <p className="mt-1 text-sm font-medium">{t("auth.verificationEmailSent")}</p>
    ) : (
      <button
        type="button"
        onClick={handleResend}
        disabled={resendLoading}
        className="mt-1 text-sm font-medium underline hover:no-underline"
      >
        {t("auth.resendVerificationEmail")}
      </button>
    )}
  </Alert>
)}
```

Add `Alert` to the import from `@/components/ui/shared`:
```tsx
import { Alert } from "@/components/ui/shared";
```

- [ ] **Step 5: Create `EmailVerifyPage.tsx`**

Create `frontend/src/pages/EmailVerifyPage.tsx`:
```tsx
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EmailVerifyPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const status = params.get("status");
  const reason = params.get("reason");

  const isSuccess = status === "success";

  function getMessage() {
    if (isSuccess) return t("auth.emailVerified");
    if (reason === "expired") return t("auth.verificationLinkExpired");
    if (reason === "already_used") return t("auth.verificationLinkAlreadyUsed");
    return t("auth.verificationLinkInvalid");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Card className="w-full max-w-sm border-slate-200 shadow-md">
        <CardHeader className="pb-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xl">📅</span>
            <span className="text-sm text-slate-500">Club Calendar</span>
          </div>
          <CardTitle className="text-xl">
            {isSuccess ? t("auth.emailVerified") : t("auth.verificationLinkInvalid")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">{getMessage()}</p>
          {isSuccess && (
            <p className="text-sm text-slate-500">{t("auth.emailVerifiedLoginPrompt")}</p>
          )}
          <Link
            to="/login"
            className="block text-sm font-medium text-blue-600 hover:underline"
          >
            {isSuccess ? t("auth.backToLogin") : t("auth.requestNewLink")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Add route to `App.tsx`**

Add the import at the top of `frontend/src/App.tsx` (with the other page imports):
```tsx
import EmailVerifyPage from "./pages/EmailVerifyPage";
```

Add the route inside `<Routes>` after the `/auth/callback` route:
```tsx
<Route path="/auth/verify-email" element={<EmailVerifyPage />} />
```

- [ ] **Step 7: Run the frontend type-checker**

```bash
npm run typecheck -w frontend 2>/dev/null || npx tsc --noEmit -p frontend/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 8: Run the frontend tests**

```bash
npm test -w frontend
```

Expected: all pass (no unit tests for these pages since they're UI-only).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/
git commit -m "feat: frontend double opt-in — check-email state, login unverified UI, verify-email page"
```

---

## Self-Review Notes

After writing the plan, checking spec coverage:

| Spec requirement | Task |
|---|---|
| User.isEmailVerified + createdAt | Task 2 |
| EmailVerification entity (split-token, invalidation, usedAt) | Task 2 + Task 4 |
| Only latest token valid | Task 4 (EmailVerificationService.createVerification invalidates prior) |
| bcrypt hash for token | Task 4 (password_hash BCRYPT) |
| Register → 202, no tokens, send email | Task 5 |
| Login → 403 email_not_verified | Task 5 |
| Resend → 204, rate-limited, silent for unknown/verified | Task 5 |
| Verify-email → redirect with status/reason | Task 5 |
| SSO creates users with isEmailVerified=true | Task 5 |
| BACKEND_URL rename | Task 1 |
| MAILER_DSN / MAILER_FROM env vars | Task 1 |
| symfony/mailer + twig-bundle | Task 3 |
| MJML compile pipeline + npm script | Task 3 |
| Translations (EN + DE, JSON, ICU) | Task 3 |
| Locale fallback to EN | Task 3 (translation.yaml) |
| Translations in lint-staged | Task 3 |
| EmailVerificationService | Task 4 |
| EmailVerificationMailer (locale, subject, TemplatedEmail) | Task 4 |
| Test: register sends email (mocked MAILER_DSN) | Task 5 |
| Test: login 403 for unverified | Task 5 |
| Test: resend silent for unknown/verified | Task 5 |
| Cleanup command (30-day prune) | Task 6 |
| Frontend: SignupPage check-email state | Task 7 |
| Frontend: LoginPage email_not_verified + resend button | Task 7 |
| Frontend: EmailVerifyPage success/error states | Task 7 |
| Frontend: route /auth/verify-email | Task 7 |
| Frontend: i18n EN + DE | Task 7 |

All spec requirements are covered.
