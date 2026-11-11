<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Kinds of security events. The method column carries password|passkey|sso|mcp for `login`,
 * totp|backup_code|passkey for `mfa_verify` and `cli` for operator actions (e.g. `mfa_disabled` via the console).
 */
enum SecurityEventType: string
{
    case LOGIN = 'login';
    case MFA_VERIFY = 'mfa_verify';
    case MFA_ENABLED = 'mfa_enabled';
    case MFA_DISABLED = 'mfa_disabled';
    case BACKUP_CODES_REGENERATED = 'backup_codes_regenerated';
    case BACKUP_CODE_USED = 'backup_code_used';
    case PASSWORD_CHANGED = 'password_changed';
    case PASSKEY_DELETED = 'passkey_deleted';
}
