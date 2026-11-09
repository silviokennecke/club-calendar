<?php

declare(strict_types=1);

namespace App\Opaque;

/** OPAQUE-3DH transcript and key schedule (RFC 9807 §6.4.2), shared by the server and the test client. */
final class KeySchedule
{
    /** §6.4.2.1 Preamble; credentialResponse = evaluated_element || masking_nonce || masked_response. */
    public static function preamble(
        string $context,
        string $clientIdentity,
        string $ke1,
        string $serverIdentity,
        string $credentialResponse,
        string $serverNonce,
        string $serverKeyshare,
    ): string {
        return 'OPAQUEv1-'
            .Bytes::i2osp(strlen($context), 2).$context
            .Bytes::i2osp(strlen($clientIdentity), 2).$clientIdentity
            .$ke1
            .Bytes::i2osp(strlen($serverIdentity), 2).$serverIdentity
            .$credentialResponse.$serverNonce.$serverKeyshare;
    }

    /** §6.4.2.2 DeriveKeys; ikm = dh(esk_s, epk_c) || dh(sk_s, epk_c) || dh(esk_s, pk_c) (same value on the client). */
    public static function deriveKeys(#[\SensitiveParameter] string $ikm, string $preamble): DerivedKeys
    {
        $transcriptHash = hash('sha512', $preamble, true);
        $prk = Hkdf::extract('', $ikm);
        $handshake = Hkdf::deriveSecret($prk, 'HandshakeSecret', $transcriptHash);
        $keys = new DerivedKeys(
            Hkdf::deriveSecret($prk, 'SessionKey', $transcriptHash),
            $handshake,
            Hkdf::deriveSecret($handshake, 'ServerMAC', ''),
            Hkdf::deriveSecret($handshake, 'ClientMAC', ''),
            $transcriptHash,
        );
        sodium_memzero($prk);

        return $keys;
    }

    public static function serverMac(DerivedKeys $keys): string
    {
        return Mac::compute($keys->serverMacKey, $keys->transcriptHash);
    }

    public static function clientMac(DerivedKeys $keys, string $preamble, string $serverMac): string
    {
        return Mac::compute($keys->clientMacKey, hash('sha512', $preamble.$serverMac, true));
    }
}
