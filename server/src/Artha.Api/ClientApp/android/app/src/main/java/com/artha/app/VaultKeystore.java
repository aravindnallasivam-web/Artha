package com.artha.app;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Seals the card vault's data key with a hardware-backed Android Keystore key
 * that can only be used within 30 s of a fingerprint / face / screen-lock
 * check, and is wiped when a new fingerprint is enrolled. The vault password
 * itself is never stored.
 */
final class VaultKeystore {

    private static final String ALIAS = "artha_card_vault";
    private static final String STORE = "AndroidKeyStore";
    private static final int AUTH_SECONDS = 30;

    private VaultKeystore() {}

    private static SecretKey key(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return (SecretKey) ks.getKey(ALIAS, null);
        }
        if (!create) return null;
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= 30) {
            spec.setUserAuthenticationParameters(AUTH_SECONDS,
                KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        } else {
            spec.setUserAuthenticationValidityDurationSeconds(AUTH_SECONDS);
        }
        if (Build.VERSION.SDK_INT >= 24) {
            spec.setInvalidatedByBiometricEnrollment(true);
        }
        gen.init(spec.build());
        return gen.generateKey();
    }

    /** Encrypt `plainB64` (needs a fingerprint check in the last 30 s). Returns base64(iv + ciphertext). */
    static String seal(String plainB64) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key(true));
        byte[] ct = c.doFinal(Base64.decode(plainB64, Base64.NO_WRAP));
        byte[] iv = c.getIV();
        ByteBuffer out = ByteBuffer.allocate(1 + iv.length + ct.length);
        out.put((byte) iv.length).put(iv).put(ct);
        return Base64.encodeToString(out.array(), Base64.NO_WRAP);
    }

    /** Decrypt what seal() returned (needs a fingerprint check in the last 30 s). */
    static String open(String sealedB64) throws Exception {
        SecretKey k = key(false);
        if (k == null) throw new IllegalStateException("No fingerprint key on this phone");
        ByteBuffer in = ByteBuffer.wrap(Base64.decode(sealedB64, Base64.NO_WRAP));
        byte[] iv = new byte[in.get() & 0xff];
        in.get(iv);
        byte[] ct = new byte[in.remaining()];
        in.get(ct);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, iv));
        return Base64.encodeToString(c.doFinal(ct), Base64.NO_WRAP);
    }

    static void forget() {
        try {
            KeyStore ks = KeyStore.getInstance(STORE);
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception ignored) {
            // Nothing to forget.
        }
    }
}
