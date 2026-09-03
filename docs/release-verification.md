# Release verification

Release binaries are published with `SHA256SUMS`, detached Cosign signatures,
an SPDX SBOM, and GitHub build provenance.

## Checksums

```sh
sha256sum -c SHA256SUMS
```

On Windows PowerShell:

```powershell
Get-FileHash .\teamvault-windows-amd64.exe -Algorithm SHA256
```

## Cosign

Verify a signature with the certificate identity and TeamVault repository as
the trusted issuer context:

```sh
cosign verify-blob teamvault-linux-amd64 \
  --signature teamvault-linux-amd64.sig \
  --certificate teamvault-linux-amd64.pem \
  --certificate-identity-regexp 'https://github.com/TimUx/TeamVault/.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same verification applies to `tvcli-*` binaries and `SHA256SUMS`.
The SPDX file describes the source and build dependencies included in the
release. GitHub's artifact-attestation UI can be used to verify the provenance
attached to `SHA256SUMS`.
