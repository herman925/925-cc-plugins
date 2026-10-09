# Vendored crypto (noble)

Pure-JS cryptography for `../crypto.ts` (#78), copied in so nothing is installed on any device. It loads in the mod
runtime as plain ES modules: no eval, no WASM, no Node.

| Folder | Package | Integrity (`npm pack`, checked against the registry) |
| --- | --- | --- |
| `noble-curves/` | `@noble/curves@2.4.0` | `sha512-P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew==` |
| `noble-ciphers/` | `@noble/ciphers@2.4.0` | `sha512-AnjFn0Jv92laAkvMrghlFZq4qQCIN/4DxFV/eooqtC2YTjB7kBeLMS2T9KJX4Dn+ZVXLOwK0lSgqDtx9gvxtiw==` |
| `noble-hashes/` | `@noble/hashes@2.4.0` | `sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==` |

Source: the npm registry tarballs of [paulmillr/noble-curves](https://github.com/paulmillr/noble-curves),
[noble-ciphers](https://github.com/paulmillr/noble-ciphers) and [noble-hashes](https://github.com/paulmillr/noble-hashes),
MIT licensed (each folder keeps its `LICENSE`).

Only the import closure of `curves/ed25519.js`, `ciphers/chacha.js` and `hashes/{argon2,scrypt,hkdf,sha2}.js` is
copied. The files are byte-for-byte the published ones with **one rewrite**: each bare `@noble/hashes/x.js` import
(in `noble-curves/ed25519.js`, `noble-curves/utils.js` and `noble-curves/abstract/frost.js`) points at the relative
path `../noble-hashes/x.js` (or `../../noble-hashes/x.js`) instead, so the mod loader resolves it with no bundler.

To update: `npm pack` the new versions, check their integrity, copy the same closure, redo that one rewrite, update
this table and run `claude plugin test` (`../crypto.test.ts` holds the known-answer vectors).
