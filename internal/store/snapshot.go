package store

// SnapshotSecret is one vault item in a StoreSnapshot (ciphertext + envelopes only).
type SnapshotSecret struct {
	Meta SecretMeta      `json:"meta"`
	Blob *CiphertextBlob `json:"blob,omitempty"`
	Envs []KeyEnvelope   `json:"envelopes"`
}

// SnapshotRecords is the backend-neutral payload inside StoreSnapshot.Records.
// Extra fields are additive: older snapshots without groups/webauthn/shares still import.
type SnapshotRecords struct {
	Tenants       []Tenant             `json:"tenants"`
	Users         []UserRecord         `json:"users"`
	Secrets       []SnapshotSecret     `json:"secrets"`
	Groups        []Group              `json:"groups,omitempty"`
	Members       []GroupMember        `json:"members,omitempty"`
	WebAuthn      []WebAuthnCredential `json:"webauthn,omitempty"`
	DirectShares  []SecretDirectShare  `json:"direct_shares,omitempty"`
	GroupShares   []SecretGroupShare   `json:"group_shares,omitempty"`
}
