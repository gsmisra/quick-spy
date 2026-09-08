# Mandatory Standard — Auto Password Encryption

Every credential in this prompt that looks like `ENC[v1:...]` is **ciphertext**,
not the real secret. SoftPlay encrypted it locally (AES-256-CTR + HMAC-SHA256,
Encrypt-then-MAC) before this prompt was ever built, specifically so no real
password, token, or API key leaves the developer's machine. You cannot decrypt
these tokens, and you must not try to guess, infer, reconstruct, or otherwise
work around what plaintext they represent.

Apply every rule below to every `ENC[v1:...]` token, with zero exceptions:

1. **Never invent, hardcode, or "helpfully fill in" a plaintext credential**
   anywhere in the generated code — not as a fallback, not as an example
   value, not commented out, not in a log message.
2. **Store each token exactly as given, verbatim, character-for-character**
   as a `private static final String` (Java) or a module-level `str`
   constant (Python) — never re-wrap, re-escape, reformat, or shorten it.
3. **Decrypt it only at the exact point of use** — immediately before it is
   passed to a login field, an `Authorization` header, a request-signing
   routine, etc. — by calling the decrypt helper described below. Never
   decrypt once up front and store the plaintext result in a variable that
   outlives that single call site.
4. **Include the decrypt helper's exact code, verbatim, exactly once** in
   the generated file, precisely as given in the fenced code block that
   follows this standard in the prompt. Do not modify, "simplify", rename,
   reformat, or rewrite any part of it — it is already implemented and
   cross-verified against the exact scheme that produced the token(s) above;
   changing so much as one line will make decryption fail at test-run time.
5. If a field has no `ENC[...]` token (nothing was entered for it in the
   Control Panel), leave it exactly as instructed elsewhere in this prompt —
   typically `(not set)` — never invent a placeholder credential for it.
6. The decrypted value must be treated as sensitive at runtime the same way
   a real secret would be: never `print`/`System.out.println` it, never
   include it in an assertion failure message, never write it to a log
   statement — even though this is non-production test data.
