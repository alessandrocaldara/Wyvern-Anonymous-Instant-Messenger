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
    /** Sérialise un point EC en hex (format non-compressé : 04 || x || y)
     */
    function serializePoint(point) {
        if (point === null) return '00';
        const xHex = point.x.toString(16).padStart(64, '0');
        const yHex = point.y.toString(16).padStart(64, '0');
        return '04' + xHex + yHex;
    }
    /** Désérialise un point EC depuis un hex (format non-compressé)
     */
    function deserializePoint(hex) {
        if (hex === '00' || !hex) return null;
        if (hex.startsWith('04') && hex.length === 130) {
            const x = BigInt('0x' + hex.substring(2, 66));
            const y = BigInt('0x' + hex.substring(66, 130));
            return { x, y };
        }
        throw new Error('Format de point non supporté (attendu: 04||x||y)');
    }

    // UTILITAIRES OCTETS
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
    function utf8Encode(str) { return new TextEncoder().encode(str); }
    function utf8Decode(bytes) { return new TextDecoder().decode(bytes); }
    function bytesToBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    function base64ToBytes(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    /** Concatène plusieurs Uint8Array
     */
    function concatBytes(...arrays) {
        let totalLen = 0;
        for (const a of arrays) totalLen += a.length;
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const a of arrays) { result.set(a, offset); offset += a.length; }
        return result;
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

    // AES-256
    // S-Box (FIPS 197)
    const AES_SBOX = [
        0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
        0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
        0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
        0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
        0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
        0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
        0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
        0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
        0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
        0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
        0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
        0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
        0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
        0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
        0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
        0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
    ];
    // Round constants pour KeyExpansion AES-256
    const AES_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

    /** Multiplication dans GF(2^8) (Rijndael), utilisé par MixColumns
     */
    function gmul(a, b) {
        let result = 0;
        for (let i = 0; i < 8; i++) {
            if (b & 1) result ^= a;
            const hiBit = a & 0x80;
            a = (a << 1) & 0xFF;
            if (hiBit) a ^= 0x1b;
            b >>= 1;
        }
        return result;
    }
    /** AES Key Expansion pour clé de 256 bits (32 octets).
     * Produit 15 round keys de 16 octets (240 octets total)
     */
    function aesKeyExpansion(key) {
        const Nk = 8, Nr = 14;
        const totalWords = 4 * (Nr + 1); // 60
        const w = new Uint8Array(totalWords * 4);
        w.set(key);

        for (let i = Nk; i < totalWords; i++) {
            const offset = i * 4;
            const prevOffset = (i - 1) * 4;
            const nkOffset = (i - Nk) * 4;

            let t0 = w[prevOffset], t1 = w[prevOffset+1], t2 = w[prevOffset+2], t3 = w[prevOffset+3];

            if (i % Nk === 0) {
                const tmp = t0;
                t0 = AES_SBOX[t1] ^ AES_RCON[(i / Nk) - 1];
                t1 = AES_SBOX[t2]; t2 = AES_SBOX[t3]; t3 = AES_SBOX[tmp];
            } else if (i % Nk === 4) {
                t0 = AES_SBOX[t0]; t1 = AES_SBOX[t1]; t2 = AES_SBOX[t2]; t3 = AES_SBOX[t3];
            }

            w[offset]   = w[nkOffset]   ^ t0;
            w[offset+1] = w[nkOffset+1] ^ t1;
            w[offset+2] = w[nkOffset+2] ^ t2;
            w[offset+3] = w[nkOffset+3] ^ t3;
        }
        return w;
    }
    /** Chiffre un seul bloc de 16 octets avec AES-256
     */
    function aesEncryptBlock(block, expandedKey) {
        const Nr = 14;
        // state en column-major
        const state = new Uint8Array(16);
        for (let col = 0; col < 4; col++)
            for (let row = 0; row < 4; row++)
                state[col * 4 + row] = block[row * 4 + col];

        // AddRoundKey initial
        for (let i = 0; i < 16; i++) state[i] ^= expandedKey[i];

        for (let round = 1; round <= Nr; round++) {
            // SubBytes
            for (let i = 0; i < 16; i++) state[i] = AES_SBOX[state[i]];
            // ShiftRows
            let tmp = state[1];
            state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = tmp;
            tmp = state[2]; state[2] = state[10]; state[10] = tmp;
            tmp = state[6]; state[6] = state[14]; state[14] = tmp;
            tmp = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = state[3]; state[3] = tmp;
            // MixColumns (sauf dernier round)
            if (round < Nr) {
                for (let col = 0; col < 4; col++) {
                    const i = col * 4;
                    const s0 = state[i], s1 = state[i+1], s2 = state[i+2], s3 = state[i+3];
                    state[i]   = gmul(2,s0) ^ gmul(3,s1) ^ s2        ^ s3;
                    state[i+1] = s0         ^ gmul(2,s1) ^ gmul(3,s2) ^ s3;
                    state[i+2] = s0         ^ s1         ^ gmul(2,s2) ^ gmul(3,s3);
                    state[i+3] = gmul(3,s0) ^ s1         ^ s2         ^ gmul(2,s3);
                }
            }
            // AddRoundKey
            const rkOffset = round * 16;
            for (let i = 0; i < 16; i++) state[i] ^= expandedKey[rkOffset + i];
        }
        // column-major → row-major
        const output = new Uint8Array(16);
        for (let col = 0; col < 4; col++)
            for (let row = 0; row < 4; row++)
                output[row * 4 + col] = state[col * 4 + row];
        return output;
    }

    // AES-GCM (Galois/Counter Mode)
    function incrementCounter(counter) {
        for (let i = 15; i >= 12; i--) { counter[i]++; if (counter[i] !== 0) break; }
    }
    function xorBytes(a, b) {
        const r = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i++) r[i] = a[i] ^ b[i];
        return r;
    }
    /** Multiplication dans GF(2^128) pour GHASH (NIST SP 800-38D)
     */
    function ghashMultiply(X, H) {
        const Z = new Uint8Array(16);
        const V = new Uint8Array(16);
        V.set(H);
        for (let i = 0; i < 16; i++) {
            for (let bit = 7; bit >= 0; bit--) {
                if ((X[i] >> bit) & 1)
                    for (let k = 0; k < 16; k++) Z[k] ^= V[k];
                const lsb = V[15] & 1;
                for (let k = 15; k > 0; k--) V[k] = (V[k] >> 1) | ((V[k-1] & 1) << 7);
                V[0] >>= 1;
                if (lsb) V[0] ^= 0xe1;
            }
        }
        return Z;
    }
    /** Padding à un multiple de 16 octets
     */
    function padTo16(data) {
        if (data.length === 0) return new Uint8Array(0);
        const padLen = (16 - (data.length % 16)) % 16;
        if (padLen === 0) return data;
        const padded = new Uint8Array(data.length + padLen);
        padded.set(data);
        return padded;
    }
    /** GHASH(H, aad, ciphertext) — tag d'authentification GCM
     */
    function ghash(H, aad, ciphertext) {
        let Y = new Uint8Array(16);
        const aadPadded = padTo16(aad);
        for (let i = 0; i < aadPadded.length; i += 16) {
            Y = xorBytes(Y, aadPadded.subarray(i, i + 16));
            Y = ghashMultiply(Y, H);
        }
        const ctPadded = padTo16(ciphertext);
        for (let i = 0; i < ctPadded.length; i += 16) {
            Y = xorBytes(Y, ctPadded.subarray(i, i + 16));
            Y = ghashMultiply(Y, H);
        }
        // bloc final : longueurs en bits
        const lenBlock = new Uint8Array(16);
        lenBlock.set(bigIntToBytes(BigInt(aad.length) * 8n, 8), 0);
        lenBlock.set(bigIntToBytes(BigInt(ciphertext.length) * 8n, 8), 8);
        Y = xorBytes(Y, lenBlock);
        Y = ghashMultiply(Y, H);
        return Y;
    }
    /** Chiffrement AES-256-GCM
     */
    function aesGcmEncrypt(key, iv, plaintext, aad) {
        if (!aad) aad = new Uint8Array(0);
        const expandedKey = aesKeyExpansion(key);
        const H = aesEncryptBlock(new Uint8Array(16), expandedKey);
        // J0 pour IV de 96 bits
        const J0 = new Uint8Array(16);
        J0.set(iv); J0[15] = 1;
        const counter = new Uint8Array(16);
        counter.set(J0);
        incrementCounter(counter);
        // chiffrement CTR
        const ciphertext = new Uint8Array(plaintext.length);
        for (let i = 0; i < plaintext.length; i += 16) {
            const keystream = aesEncryptBlock(counter, expandedKey);
            const blockLen = Math.min(16, plaintext.length - i);
            for (let j = 0; j < blockLen; j++) ciphertext[i+j] = plaintext[i+j] ^ keystream[j];
            incrementCounter(counter);
        }
        // tag
        const ghashResult = ghash(H, aad, ciphertext);
        const encJ0 = aesEncryptBlock(J0, expandedKey);
        const tag = xorBytes(ghashResult, encJ0);
        return { ciphertext, tag };
    }
    /** Déchiffrement AES-256-GCM
     */
    function aesGcmDecrypt(key, iv, ciphertext, tag, aad) {
        if (!aad) aad = new Uint8Array(0);
        const expandedKey = aesKeyExpansion(key);
        const H = aesEncryptBlock(new Uint8Array(16), expandedKey);
        const J0 = new Uint8Array(16);
        J0.set(iv); J0[15] = 1;
        // vérifier le tag AVANT de déchiffrer
        const ghashResult = ghash(H, aad, ciphertext);
        const encJ0 = aesEncryptBlock(J0, expandedKey);
        const expectedTag = xorBytes(ghashResult, encJ0);
        let diff = 0;
        for (let i = 0; i < 16; i++) diff |= expectedTag[i] ^ tag[i];
        if (diff !== 0) throw new Error('AES-GCM: tag invalide (message falsifié ou mauvaise clé)');
        // déchiffrement CTR
        const counter = new Uint8Array(16);
        counter.set(J0);
        incrementCounter(counter);
        const plaintext = new Uint8Array(ciphertext.length);
        for (let i = 0; i < ciphertext.length; i += 16) {
            const keystream = aesEncryptBlock(counter, expandedKey);
            const blockLen = Math.min(16, ciphertext.length - i);
            for (let j = 0; j < blockLen; j++) plaintext[i+j] = ciphertext[i+j] ^ keystream[j];
            incrementCounter(counter);
        }
        return plaintext;
    }

    // SHA-256
    const SHA256_K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    const SHA256_H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
    /** SHA-256 sur un Uint8Array, retourne 32 octets
     */
    function sha256(message) {
        const msgLen = message.length;
        const bitLen = msgLen * 8;
        let padLen = 64 - ((msgLen + 9) % 64);
        if (padLen === 64) padLen = 0;
        const padded = new Uint8Array(msgLen + 1 + padLen + 8);
        padded.set(message);
        padded[msgLen] = 0x80;
        const view = new DataView(padded.buffer);
        view.setUint32(padded.length - 4, bitLen, false);

        let h0=SHA256_H0[0],h1=SHA256_H0[1],h2=SHA256_H0[2],h3=SHA256_H0[3];
        let h4=SHA256_H0[4],h5=SHA256_H0[5],h6=SHA256_H0[6],h7=SHA256_H0[7];
        const W = new Uint32Array(64);

        for (let offset = 0; offset < padded.length; offset += 64) {
            for (let t = 0; t < 16; t++) W[t] = view.getUint32(offset + t * 4, false);
            for (let t = 16; t < 64; t++) {
                const s0 = rotr32(W[t-15],7) ^ rotr32(W[t-15],18) ^ (W[t-15]>>>3);
                const s1 = rotr32(W[t-2],17) ^ rotr32(W[t-2],19)  ^ (W[t-2]>>>10);
                W[t] = (W[t-16] + s0 + W[t-7] + s1) >>> 0;
            }
            let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
            for (let t = 0; t < 64; t++) {
                const S1 = rotr32(e,6) ^ rotr32(e,11) ^ rotr32(e,25);
                const ch = (e & f) ^ (~e & g);
                const temp1 = (h + S1 + ch + SHA256_K[t] + W[t]) >>> 0;
                const S0 = rotr32(a,2) ^ rotr32(a,13) ^ rotr32(a,22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const temp2 = (S0 + maj) >>> 0;
                h=g; g=f; f=e; e=(d+temp1)>>>0; d=c; c=b; b=a; a=(temp1+temp2)>>>0;
            }
            h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
            h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
        }
        const hash = new Uint8Array(32);
        const hv = new DataView(hash.buffer);
        hv.setUint32(0,h0,false); hv.setUint32(4,h1,false); hv.setUint32(8,h2,false); hv.setUint32(12,h3,false);
        hv.setUint32(16,h4,false); hv.setUint32(20,h5,false); hv.setUint32(24,h6,false); hv.setUint32(28,h7,false);
        return hash;
    }
    /** HMAC-SHA256
     */
    function hmacSha256(key, message) {
        const blockSize = 64;
        if (key.length > blockSize) key = sha256(key);
        const paddedKey = new Uint8Array(blockSize);
        paddedKey.set(key);
        const ipad = new Uint8Array(blockSize);
        const opad = new Uint8Array(blockSize);
        for (let i = 0; i < blockSize; i++) {
            ipad[i] = paddedKey[i] ^ 0x36;
            opad[i] = paddedKey[i] ^ 0x5c;
        }
        return sha256(concatBytes(opad, sha256(concatBytes(ipad, message))));
    }
    /** PBKDF2-SHA256
     */
    function pbkdf2(password, salt, iterations, dkLen) {
        const passwordBytes = utf8Encode(password);
        const numBlocks = Math.ceil(dkLen / 32);
        const dk = new Uint8Array(numBlocks * 32);
        for (let blockIndex = 1; blockIndex <= numBlocks; blockIndex++) {
            const blockBytes = new Uint8Array(4);
            blockBytes[0] = (blockIndex >>> 24) & 0xFF;
            blockBytes[1] = (blockIndex >>> 16) & 0xFF;
            blockBytes[2] = (blockIndex >>> 8) & 0xFF;
            blockBytes[3] = blockIndex & 0xFF;
            let U = hmacSha256(passwordBytes, concatBytes(salt, blockBytes));
            const T = new Uint8Array(U);
            for (let iter = 2; iter <= iterations; iter++) {
                U = hmacSha256(passwordBytes, U);
                for (let j = 0; j < 32; j++) T[j] ^= U[j];
            }
            dk.set(T, (blockIndex - 1) * 32);
        }
        return dk.subarray(0, dkLen);
    }

    // EC-ELGAMAL HYBRIDE
    /** Génère une paire de clés EC sur secp256k1
     */
    function generateKeypair() {
        const privateKey = cryptoRandomScalar(SECP256K1_N);
        const publicKey = scalarMult(privateKey, SECP256K1_G);
        if (!isOnCurve(publicKey)) throw new Error('Clé publique hors courbe');
        return { privateKey, publicKey };
    }
    /** Chiffre la clé privée avec AES-GCM(PBKDF2(mot_de_passe))
     * Retourne base64(salt_16 || iv_12 || ciphertext || tag_16)
     */
    function protectPrivateKey(privateKey, password) {
        const salt = cryptoRandomBytes(16);
        const derivedKey = pbkdf2(password, salt, 100000, 32);
        const iv = cryptoRandomBytes(12);
        const keyBytes = bigIntToBytes(privateKey, 32);
        const { ciphertext, tag } = aesGcmEncrypt(derivedKey, iv, keyBytes);
        return bytesToBase64(concatBytes(salt, iv, ciphertext, tag));
    }
    /** Déchiffre la clé privée depuis le blob base64 stocké en BDD
     */
    function recoverPrivateKey(encryptedBlob, password) {
        const blob = base64ToBytes(encryptedBlob);
        const salt       = blob.subarray(0, 16);
        const iv         = blob.subarray(16, 28);
        const ciphertext = blob.subarray(28, blob.length - 16);
        const tag        = blob.subarray(blob.length - 16);
        const derivedKey = pbkdf2(password, salt, 100000, 32);
        const keyBytes = aesGcmDecrypt(derivedKey, iv, ciphertext, tag);
        return bytesToBigInt(keyBytes);
    }
    /** Encode une clé AES de 32 octets en un point sur secp256k1.
     * Retourne le point ou null si la clé n'est pas encodable (réessayer avec une autre)
     */
    function encodeKeyAsPoint(key) {
        const p = SECP256K1_P;
        const x = bytesToBigInt(key);
        //la clé doit être < p pour que le roundtrip fonctionne (quasi-certain, p ≈ 2^256)
        if (x === 0n || x >= p) return null;
        const y2 = ((x * x % p) * x % p + SECP256K1_B) % p;
        //vérifier que y² est un résidu quadratique (~50% de chances)
        if (y2 === 0n || modPow(y2, (p - 1n) / 2n, p) === 1n) {
            return { x, y: modSqrt(y2, p) };
        }
        return null; //pas de y valide, l'appelant doit réessayer avec une autre clé
    }
    /** Décode un point en les 32 octets de clé AES originaux
     */
    function decodePointToKey(point) {
        return bigIntToBytes(point.x, 32);
    }
    /** Chiffre un message pour UN destinataire (DM)
     * Schéma hybride : AES-GCM(k) + EC-ElGamal(H_dest, k)
     */
    function encryptMessage(plaintext, recipientPubKey) {
        //générer une clé AES encodable en point EC (retry si échec, ~2 essais en moyenne)
        let k, kPoint;
        do { k = cryptoRandomBytes(32); kPoint = encodeKeyAsPoint(k); } while (!kPoint);
        const iv = cryptoRandomBytes(12);
        const { ciphertext, tag } = aesGcmEncrypt(k, iv, utf8Encode(plaintext));
        const r = cryptoRandomScalar(SECP256K1_N);
        const C1 = scalarMult(r, SECP256K1_G);
        const C2 = pointAdd(kPoint, scalarMult(r, recipientPubKey));
        return {
            ciphertext: bytesToBase64(concatBytes(ciphertext, tag)),
            C1: serializePoint(C1),
            C2: serializePoint(C2),
            iv: bytesToBase64(iv)
        };
    }
    /** Déchiffre un message DM
     */
    function decryptMessage(ciphertextB64, C1hex, C2hex, ivB64, myPrivateKey) {
        const ctWithTag = base64ToBytes(ciphertextB64);
        const iv = base64ToBytes(ivB64);
        const ciphertext = ctWithTag.subarray(0, ctWithTag.length - 16);
        const tag = ctWithTag.subarray(ctWithTag.length - 16);
        const C1 = deserializePoint(C1hex);
        const C2 = deserializePoint(C2hex);
        const kPoint = pointSubtract(C2, scalarMult(myPrivateKey, C1));
        const k = decodePointToKey(kPoint);
        return utf8Decode(aesGcmDecrypt(k, iv, ciphertext, tag));
    }
    /** Chiffre un message pour un SALON (N destinataires)
     * Le corps est chiffré une fois, la clé AES est chiffrée N fois
     */
    function encryptChannelMessage(plaintext, membersPubKeys) {
        //générer une clé AES encodable en point EC (retry si échec, ~2 essais en moyenne)
        let k, kPoint;
        do { k = cryptoRandomBytes(32); kPoint = encodeKeyAsPoint(k); } while (!kPoint);
        const iv = cryptoRandomBytes(12);
        const { ciphertext, tag } = aesGcmEncrypt(k, iv, utf8Encode(plaintext));
        const encryptedKeys = {};
        for (const member of membersPubKeys) {
            const r = cryptoRandomScalar(SECP256K1_N);
            const C1 = scalarMult(r, SECP256K1_G);
            const C2 = pointAdd(kPoint, scalarMult(r, member.pubkey));
            encryptedKeys[member.user_id] = serializePoint(C1) + '|' + serializePoint(C2);
        }
        return {
            ciphertext: bytesToBase64(concatBytes(ciphertext, tag)),
            iv: bytesToBase64(iv),
            encryptedKeys
        };
    }
    /** Déchiffre un message de salon
     */
    function decryptChannelMessage(payload, myUserId, myPrivateKey) {
        const myKeyData = payload.encryptedKeys[myUserId];
        if (!myKeyData) throw new Error('Pas de clé pour cet utilisateur');
        const [C1hex, C2hex] = myKeyData.split('|');
        return decryptMessage(payload.ciphertext, C1hex, C2hex, payload.iv, myPrivateKey);
    }

    return {
        modInverse, modPow, modSqrt,
        pointAdd, pointDouble, scalarMult, isOnCurve, pointSubtract, pointNegate,
        serializePoint, deserializePoint,
        bytesToBigInt, bigIntToBytes, bytesToHex, hexToBytes,
        bytesToBase64, base64ToBytes, utf8Encode, utf8Decode,
        cryptoRandomBytes, cryptoRandomScalar,
        aesGcmEncrypt, aesGcmDecrypt,
        sha256, hmacSha256, pbkdf2,
        generateKeypair, protectPrivateKey, recoverPrivateKey,
        encryptMessage, decryptMessage,
        encryptChannelMessage, decryptChannelMessage,
        SECP256K1: { P: SECP256K1_P, A: SECP256K1_A, B: SECP256K1_B, G: SECP256K1_G, N: SECP256K1_N }
    };
})();