/** Module cryptographique pour Wyvern
 * EC-ElGamal + AES-GCM
 */
const WyvernCrypto = (function() {
    'use strict';
    // ARITHMÉTIQUE MODULAIRE
    /** Inverse modulaire via l'algorithme d'Euclide étendu.
     * Retourne t tel que (a * t) mod p === 1n
     */
    function modInverse(a, p) {
        a = ((a % p) + p) % p;
        let t = 0n;
        let newT = 1n;
        let r = p;
        let newR = a;

        while (newR !== 0n) {
            const quotient = r / newR;
            [t, newT] = [newT, t - quotient * newT];
            [r, newR] = [newR, r - quotient * newR];
        }

        if (r > 1n) {
            throw new Error('modInverse: a est pas inversible modulo p');
        }
        if (t < 0n) {
            t = t + p;
        }
        return t;
    }
    /** Exponentiation modulaire rapide
     */
    function modPow(base, exp, mod) {
        base = ((base % mod) + mod) % mod;
        let result = 1n;
        while (exp > 0n) {
            if (exp & 1n) {
                result = (result * base) % mod;
            }
            base = (base * base) % mod;
            exp >>= 1n;
        }
        return result;
    }
    /** Racine carrée modulaire.
     * Valide uniquement si p ≡ 3 (mod 4), ce qui est vrai pour secp256k1
     */
    function modSqrt(a, p) {
        // Pour p ≡ 3 (mod 4) : sqrt(a) = a^((p+1)/4) mod p
        return modPow(a, (p + 1n) / 4n, p);
    }
    // COURBE ELLIPTIQUE secp256k1
    // Paramètres de la courbe
    const SECP256K1_P  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
    const SECP256K1_A  = 0n;
    const SECP256K1_B  = 7n;
    const SECP256K1_N  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
    const SECP256K1_GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
    const SECP256K1_GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
    const SECP256K1_G  = { x: SECP256K1_GX, y: SECP256K1_GY };

    // Vérifie qu'un point est sur la courbe y² = x³ + 7 (mod p).
    function isOnCurve(P) {
        if (P === null) return true; // Point à l'infini
        const { x, y } = P;
        const lhs = (y * y) % SECP256K1_P;
        const rhs = ((x * x * x) + SECP256K1_B) % SECP256K1_P;
        return lhs === rhs;
    }
    /** Addition de deux points P + Q sur secp256k1.
     * null représente le point à l'infini O
     */
    function pointAdd(P, Q) {
        if (P === null) return Q;
        if (Q === null) return P;

        const p = SECP256K1_P;

        // P + (-P) = O
        if (P.x === Q.x && ((P.y + Q.y) % p === 0n)) {
            return null;
        }

        let lambda;
        if (P.x === Q.x && P.y === Q.y) {
            // Doublage : même point
            return pointDouble(P);
        } else {
            // Pente de la droite (P, Q)
            const dx = ((Q.x - P.x) % p + p) % p;
            const dy = ((Q.y - P.y) % p + p) % p;
            lambda = (dy * modInverse(dx, p)) % p;
        }

        const x3 = ((lambda * lambda - P.x - Q.x) % p + p) % p;
        const y3 = ((lambda * (P.x - x3) - P.y) % p + p) % p;

        return { x: x3, y: y3 };
    }
    /**Doublage d'un point : P + P.
    */
     function pointDouble(P) {
        if (P === null || P.y === 0n) return null;

        const p = SECP256K1_P;
        // lambda = (3x² + a) / (2y) — a = 0 pour secp256k1
        const num = (3n * P.x * P.x + SECP256K1_A) % p;
        const den = (2n * P.y) % p;
        const lambda = (num * modInverse(den, p)) % p;

        const x3 = ((lambda * lambda - 2n * P.x) % p + p) % p;
        const y3 = ((lambda * (P.x - x3) - P.y) % p + p) % p;

        return { x: x3, y: y3 };
    }
    /** Multiplication scalaire k·P (double-and-add)
     */
    function scalarMult(k, P) {
        if (k === 0n) return null;
        if (k < 0n) {
            k = -k;
            P = pointNegate(P);
        }

        let result = null;   // Point à l'infini
        let addend = P;

        while (k > 0n) {
            if (k & 1n) {
                result = pointAdd(result, addend);
            }
            addend = pointDouble(addend);
            k >>= 1n;
        }

        return result;
    }
    /**Négation d'un point : -P = (x, -y mod p)
     */
    function pointNegate(P) {
        if (P === null) return null;
        return { x: P.x, y: (SECP256K1_P - P.y) % SECP256K1_P };
    }
    /** Soustraction de points : P - Q = P + (-Q)
     */
    function pointSubtract(P, Q) {
        return pointAdd(P, pointNegate(Q));
    }

    // Utilitaires
    /** Convertit un Uint8Array en BigInt (big-endian).
     */
    function bytesToBigInt(bytes) {
        let result = 0n;
        for (let i = 0; i < bytes.length; i++) {
            result = (result << 8n) | BigInt(bytes[i]);
        }
        return result;
    }
    /** Convertit un BigInt en Uint8Array de longueur fixe (big-endian)
     */
    function bigIntToBytes(n, length) {
        const bytes = new Uint8Array(length);
        let val = n;
        for (let i = length - 1; i >= 0; i--) {
            bytes[i] = Number(val & 0xFFn);
            val >>= 8n;
        }
        return bytes;
    }
    /** Hex string → Uint8Array
     */
    function hexToBytes(hex) {
        const len = hex.length;
        const bytes = new Uint8Array(len / 2);
        for (let i = 0; i < len; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
    }
    /** Uint8Array → hex string
     */
    function bytesToHex(bytes) {
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
    }
    /** Génère n octets aléatoires cryptographiquement sûrs.
     */
    function cryptoRandomBytes(n) {
        const buf = new Uint8Array(n);
        crypto.getRandomValues(buf);
        return buf;
    }
    /** Génère un scalaire aléatoire dans [1, max-1].
     */
    function cryptoRandomScalar(max) {
        const byteLen = Math.ceil(max.toString(16).length / 2);
        let scalar;
        do {
            scalar = bytesToBigInt(cryptoRandomBytes(byteLen));
        } while (scalar < 1n || scalar >= max);
        return scalar;
    }
    
    return {
        modInverse, modPow, modSqrt,
        pointAdd, pointDouble, scalarMult, isOnCurve, pointSubtract,
        bytesToBigInt, bigIntToBytes, cryptoRandomBytes, cryptoRandomScalar,
        // Constantes exposées pour les tests futurs:
        SECP256K1: { P: SECP256K1_P, A: SECP256K1_A, B: SECP256K1_B, G: SECP256K1_G, N: SECP256K1_N }
    };
})();