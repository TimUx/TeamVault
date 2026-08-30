package cryptocore_test

import (
	"bytes"
	"errors"
	"testing"

	"github.com/teamvault/teamvault/internal/cryptocore"
)

// Fast params for unit tests only — production uses DefaultArgon2 / tenant settings.
var testArgon = cryptocore.Argon2Params{Time: 1, Memory: 8 * 1024, Threads: 1, KeyLen: 32}

func TestCreateUnlockRoundTrip(t *testing.T) {
	pw := []byte("correct horse battery staple!!")
	kp, sealed, err := cryptocore.CreateIdentity(pw, testArgon)
	if err != nil {
		t.Fatal(err)
	}
	sk, mk, err := cryptocore.UnlockIdentity(pw, sealed)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		for i := range sk {
			sk[i] = 0
		}
		for i := range mk {
			mk[i] = 0
		}
	}()
	if !bytes.Equal(sk, kp.Private[:]) {
		t.Fatal("private key mismatch after unlock")
	}
}

func TestWrongPasswordFails(t *testing.T) {
	pw := []byte("right-password-32chars-minimum!")
	_, sealed, err := cryptocore.CreateIdentity(pw, testArgon)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = cryptocore.UnlockIdentity([]byte("wrong-password-32chars-minimum!!"), sealed)
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("got %v", err)
	}
}

func TestCorruptPrivateKeyCiphertext(t *testing.T) {
	pw := []byte("right-password-32chars-minimum!")
	_, sealed, err := cryptocore.CreateIdentity(pw, testArgon)
	if err != nil {
		t.Fatal(err)
	}
	sealed.Ciphertext[0] ^= 0xff
	_, _, err = cryptocore.UnlockIdentity(pw, sealed)
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("got %v", err)
	}
}

func TestPayloadEncryptDecryptAndCorrupt(t *testing.T) {
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	pt := []byte(`{"title":"x","password":"s3cret"}`)
	ct, err := cryptocore.EncryptPayload(pt, dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	out, err := cryptocore.DecryptPayload(ct, dk, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, pt) {
		t.Fatal("payload mismatch")
	}
	ct.Ciphertext[0] ^= 0x01
	_, err = cryptocore.DecryptPayload(ct, dk, nil)
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("corrupt: %v", err)
	}
}

func TestWrongDataKeyFails(t *testing.T) {
	dk, _ := cryptocore.GenerateDataKey()
	other, _ := cryptocore.GenerateDataKey()
	ct, _ := cryptocore.EncryptPayload([]byte("hi"), dk, 1)
	_, err := cryptocore.DecryptPayload(ct, other, nil)
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("got %v", err)
	}
}

func TestRevokedKeyVersionRejected(t *testing.T) {
	dk, _ := cryptocore.GenerateDataKey()
	ct, _ := cryptocore.EncryptPayload([]byte("hi"), dk, 2)
	revoked := map[uint32]struct{}{2: {}}
	_, err := cryptocore.DecryptPayload(ct, dk, revoked)
	if !errors.Is(err, cryptocore.ErrRevokedVersion) {
		t.Fatalf("got %v", err)
	}
}

func TestShareEnvelopeRoundTrip(t *testing.T) {
	owner, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	peer, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	dk, _ := cryptocore.GenerateDataKey()
	env, err := cryptocore.SealDataKeyForRecipient(dk, peer.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	got, err := cryptocore.OpenDataKeyEnvelope(env, peer.Private[:])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, dk) {
		t.Fatal("dk mismatch")
	}
	// Wrong recipient cannot open
	_, err = cryptocore.OpenDataKeyEnvelope(env, owner.Private[:])
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("wrong recipient: %v", err)
	}
}

func TestRotateSecretNewVersion(t *testing.T) {
	a, _ := cryptocore.GenerateKeyPair()
	b, _ := cryptocore.GenerateKeyPair()
	pt := []byte("rotated-secret-payload")
	dk, ct, envs, err := cryptocore.RotateSecret(pt, 3, [][]byte{a.Public[:], b.Public[:]})
	if err != nil {
		t.Fatal(err)
	}
	if ct.KeyVersion != 3 || len(envs) != 2 {
		t.Fatalf("ver=%d envs=%d", ct.KeyVersion, len(envs))
	}
	dkA, err := cryptocore.OpenDataKeyEnvelope(envs[0], a.Private[:])
	if err != nil {
		t.Fatal(err)
	}
	out, err := cryptocore.DecryptPayload(ct, dkA, nil)
	if err != nil || !bytes.Equal(out, pt) {
		t.Fatalf("decrypt after rotate: %v %q", err, out)
	}
	// Old version marked revoked must fail even with old dk if caller checks map
	_ = dk
	revoked := map[uint32]struct{}{1: {}, 2: {}}
	oldCT, _ := cryptocore.EncryptPayload(pt, dk, 1)
	_, err = cryptocore.DecryptPayload(oldCT, dk, revoked)
	if !errors.Is(err, cryptocore.ErrRevokedVersion) {
		t.Fatalf("got %v", err)
	}
}

func TestRecoveryKitUnlock(t *testing.T) {
	kp, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	kit, err := cryptocore.GenerateRecoveryKitSeed()
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := cryptocore.SealPrivateKeyWithRecoveryKey(kp.Private[:], kit, testArgon)
	if err != nil {
		t.Fatal(err)
	}
	rk, err := cryptocore.DeriveMasterKey(kit, sealed.Salt, sealed.Params)
	if err != nil {
		t.Fatal(err)
	}
	sk, err := cryptocore.OpenPrivateKey(sealed.Nonce, sealed.Ciphertext, rk)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(sk, kp.Private[:]) {
		t.Fatal("recovery unlock mismatch")
	}
	// Wrong kit
	bad := append([]byte{}, kit...)
	bad[0] ^= 1
	rk2, _ := cryptocore.DeriveMasterKey(bad, sealed.Salt, sealed.Params)
	_, err = cryptocore.OpenPrivateKey(sealed.Nonce, sealed.Ciphertext, rk2)
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("got %v", err)
	}
}

func TestAADBindsKeyVersion(t *testing.T) {
	dk, _ := cryptocore.GenerateDataKey()
	ct, _ := cryptocore.EncryptPayload([]byte("x"), dk, 5)
	ct.KeyVersion = 6 // tamper version without re-encrypt
	_, err := cryptocore.DecryptPayload(ct, dk, nil)
	if !errors.Is(err, cryptocore.ErrAuthFailed) {
		t.Fatalf("aad tamper: %v", err)
	}
}
